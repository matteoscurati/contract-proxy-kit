import should from 'should'
import Web3Maj1Min3 from 'web3-1-3'
import Web3Maj2Alpha from 'web3-2-alpha'
import CPK, {
  Web3Adapter,
  Transaction,
  TransactionResult,
  TransactionManager,
  NetworksConfig
} from '../../src'
import { testSafeTransactions } from '../transactions/testSafeTransactions'
import { testConnectedSafeTransactionsWithRelay } from '../transactions/testConnectedSafeTransactionsWithRelay'
import { toTxHashPromise, AccountType } from '../utils'
import { getContractInstances, TestContractInstances } from '../utils/contracts'
import { Address } from '../../src/utils/basicTypes'

interface ShouldWorkWithWeb3Props {
  Web3: typeof Web3Maj1Min3 | typeof Web3Maj2Alpha
  defaultAccountBox: Address[]
  safeOwnerBox: Address[]
  gnosisSafeProviderBox: any
  transactionManager?: TransactionManager
}

export function shouldWorkWithWeb3({
  Web3,
  defaultAccountBox,
  safeOwnerBox,
  gnosisSafeProviderBox,
  transactionManager
}: ShouldWorkWithWeb3Props): void {
  describe(`with Web3 version ${new Web3(Web3.givenProvider).version}`, () => {
    let contracts: TestContractInstances
    const ueb3 = new Web3('http://localhost:8545')
    const isCpkTransactionManager =
      !transactionManager || transactionManager.config.name === 'CpkTransactionManager'

    const testHelperMaker = (web3Box: any): any => ({
      checkAddressChecksum: (address?: Address): boolean => {
        if (!address) {
          return false
        }
        return web3Box[0].utils.checkAddressChecksum(address)
      },
      sendTransaction: (txObj: any): any => toTxHashPromise(web3Box[0].eth.sendTransaction(txObj)),
      randomHexWord: (): string => web3Box[0].utils.randomHex(32),
      fromWei: (amount: number): number => Number(web3Box[0].utils.fromWei(amount)),
      getTransactionCount: (account: Address): number =>
        web3Box[0].eth.getTransactionCount(account),
      testedTxObjProps: 'the PromiEvent for the transaction and the hash',
      getBalance: (address: Address): number =>
        web3Box[0].eth
          .getBalance(address)
          .then((balance: number) => web3Box[0].utils.toBN(balance)),
      checkTxObj: (txResult: TransactionResult): void => {
        should.exist(txResult.hash)
      },
      waitTxReceipt: async (txResult: TransactionResult): Promise<any> => {
        let receipt = await web3Box[0].eth.getTransactionReceipt(txResult.hash)
        while (!receipt) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          receipt = await web3Box[0].eth.getTransactionReceipt(txResult.hash)
        }
        return receipt
      }
    })

    const ueb3TestHelpers = testHelperMaker([ueb3])

    before('setup contracts', async () => {
      contracts = getContractInstances()
    })

    it('should not produce ethLibAdapter instances when web3 not provided', async () => {
      ;((): Web3Adapter => new Web3Adapter({} as any)).should.throw(
        'web3 property missing from options'
      )
    })

    it('should not produce CPK instances when web3 not connected to a recognized network', async () => {
      const ethLibAdapter = new Web3Adapter({ web3: ueb3 })
      await CPK.create({ ethLibAdapter }).should.be.rejectedWith(/unrecognized network ID \d+/)
    })

    describe('with valid networks configuration', () => {
      let networks: NetworksConfig

      before('obtain addresses from artifacts', async () => {
        const { gnosisSafe, cpkFactory, multiSend, defaultCallbackHandler } = contracts

        networks = {
          [await ueb3.eth.net.getId()]: {
            masterCopyAddress: gnosisSafe.address,
            proxyFactoryAddress: cpkFactory.address,
            multiSendAddress: multiSend.address,
            fallbackHandlerAddress: defaultCallbackHandler.address
          }
        }
      })

      it('can produce instances', async () => {
        const ethLibAdapter = new Web3Adapter({ web3: ueb3 })
        should.exist(ethLibAdapter)
        should.exist(await CPK.create({ ethLibAdapter, networks }))
        should.exist(
          await CPK.create({
            ethLibAdapter,
            networks,
            ownerAccount: defaultAccountBox[0]
          })
        )
        should.exist(await CPK.create({ ethLibAdapter, transactionManager, networks }))
        should.exist(
          await CPK.create({
            ethLibAdapter,
            transactionManager,
            networks,
            ownerAccount: defaultAccountBox[0]
          })
        )
      })

      it('can encode multiSend call data', async () => {
        const { multiStep } = contracts
        const transactions: Transaction[] = [
          {
            to: multiStep.address,
            data: multiStep.contract.methods.doStep(1).encodeABI()
          },
          {
            to: multiStep.address,
            data: multiStep.contract.methods.doStep(2).encodeABI()
          }
        ]

        const ethLibAdapter = new Web3Adapter({ web3: ueb3 })
        const uninitializedCPK = new CPK({ ethLibAdapter })
        const dataHash = uninitializedCPK.encodeMultiSendCallData(transactions)

        const multiStepAddress = multiStep.address.slice(2).toLowerCase()
        dataHash.should.be.equal(
          `0x8d80ff0a000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000f200${multiStepAddress}00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024c01cf093000000000000000000000000000000000000000000000000000000000000000100${multiStepAddress}00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024c01cf09300000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000`
        )
      })

      describe('with warm instance', () => {
        let cpk: CPK

        before('create instance', async () => {
          const ethLibAdapter = new Web3Adapter({ web3: ueb3 })

          cpk = await CPK.create({
            ethLibAdapter,
            transactionManager,
            networks,
            ownerAccount: defaultAccountBox[0]
          })

          if (transactionManager) {
            await ueb3TestHelpers.sendTransaction({
              from: defaultAccountBox[0],
              to: cpk.address,
              value: `${3e18}`
            })
          }
        })

        before('warm instance', async () => {
          const idPrecompile = `0x${'0'.repeat(39)}4`
          await cpk.execTransactions([
            {
              to: idPrecompile
            }
          ])
        })

        testSafeTransactions({
          web3: ueb3,
          ...ueb3TestHelpers,
          async getCPK() {
            return cpk
          },
          isCpkTransactionManager,
          accountType: AccountType.Warm
        })
      })

      describe('with fresh accounts', () => {
        testSafeTransactions({
          web3: ueb3,
          ...ueb3TestHelpers,
          async getCPK() {
            const newAccount = ueb3.eth.accounts.create()
            ueb3.eth.accounts.wallet.add(newAccount)
            await ueb3TestHelpers.sendTransaction({
              from: defaultAccountBox[0],
              to: newAccount.address,
              value: `${3e18}`,
              gas: '0x5b8d80'
            })

            const ethLibAdapter = new Web3Adapter({ web3: ueb3 })
            return CPK.create({
              ethLibAdapter,
              transactionManager,
              networks,
              ownerAccount: newAccount.address
            })
          },
          isCpkTransactionManager,
          accountType: AccountType.Fresh
        })
      })

      describe('with mock connected to a Gnosis Safe provider', () => {
        const safeWeb3Box: any[] = []

        before('create Web3 instance', async () => {
          safeWeb3Box[0] = new Web3(gnosisSafeProviderBox[0])
        })

        let cpk: CPK

        before('create instance', async () => {
          const ethLibAdapter = new Web3Adapter({ web3: safeWeb3Box[0] })

          cpk = await CPK.create({ ethLibAdapter, transactionManager, networks })

          if (transactionManager) {
            await ueb3TestHelpers.sendTransaction({
              from: defaultAccountBox[0],
              to: cpk.address,
              value: `${3e18}`
            })
          }
        })

        if (!isCpkTransactionManager) {
          testConnectedSafeTransactionsWithRelay({
            web3: ueb3,
            ...testHelperMaker(safeWeb3Box),
            async getCPK() {
              return cpk
            },
            ownerIsRecognizedContract: true,
            executor: safeOwnerBox
          })
          return
        }

        testSafeTransactions({
          web3: ueb3,
          ...testHelperMaker(safeWeb3Box),
          async getCPK() {
            return cpk
          },
          ownerIsRecognizedContract: true,
          executor: safeOwnerBox,
          isCpkTransactionManager,
          accountType: AccountType.Connected
        })
      })
    })
  })
}
