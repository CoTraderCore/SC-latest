/* globals describe, it, artifacts, contract, before, beforeEach, after, assert, web3 */

// Activate verbose mode by setting env var `export DEBUG=cot`
require("babel-polyfill");
const debug = require("debug")("cot");
//const BN = require('bignumber.js')
const util = require("./util.js");
const { DECIMALS } = util;
const SmartFund = artifacts.require("./SmartFund.sol");
const SmartBank = artifacts.require("./SmartBank.sol");
const BAT = artifacts.require("./tokens/BAT.sol");
const COT = artifacts.require("./tokens/COT.sol");
const ExchangePortal = artifacts.require("./contracts/ExchangePortalMock.sol");
const PermittedExchanges = artifacts.require("./PermittedExchanges.sol");

const ETH_TOKEN_ADDRESS = "0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

contract("SmartFund", function(accounts) {
  // This only runs once across all test suites
  before(() => util.measureGas(accounts));
  after(() => util.measureGas(accounts));
  // if (util.isNotFocusTest('core')) return
  const eq = assert.equal.bind(assert);
  const user1 = accounts[0];
  const user2 = accounts[1];
  const user3 = accounts[2];
  const platform = accounts[3];
  let smartFund, smartBank, bat, cot, exchangePortal, permittedExchanges;
  let newSmartFund, newSmartBank;
  const logEvents = [];
  const pastEvents = [];

  async function deployContract(successFee = 0, platformFee = 0) {
    debug("deploying contract");

    exchangePortal = await ExchangePortal.new(1, 1);
    permittedExchanges = await PermittedExchanges.new(exchangePortal.address);
    smartFund = await SmartFund.new(
      user1,
      "testFund",
      successFee,
      platformFee,
      platform,
      exchangePortal.address,
      permittedExchanges.address
    );

    // create smartBank
    smartBank = await SmartBank.new(user1, smartFund.address);

    // bind fund with bank
    await smartFund.BankInitializer(smartBank.address, { from: platform });

    bat = await BAT.new();
    cot = await COT.new(user1);

    const eventsWatch = smartFund.allEvents();
    eventsWatch.watch((err, res) => {
      if (err) return;
      pastEvents.push(res);
      debug(">>", res.event, res.args);
    });
    logEvents.push(eventsWatch);
  }

  async function newFundAndBank(
    successFee = 0,
    platformFee = 0,
    exchangePortal,
    permittedExchanges
  ) {
    // create new smartFund
    newSmartFund = await SmartFund.new(
      user1,
      "testFund",
      successFee,
      platformFee,
      platform,
      exchangePortal.address,
      permittedExchanges.address
    );

    // create new smartBank
    newSmartBank = await SmartBank.new(user1, newSmartFund.address);

    // bind new fund with new bank
    await newSmartFund.BankInitializer(newSmartBank.address, {
      from: platform
    });
  }

  after(function() {
    logEvents.forEach(ev => ev.stopWatching());
  });

  describe("Initial state", function() {
    before(deployContract);

    it("should have no shares and proper addresses set", async function() {
      const totalShares = await smartBank.totalShares();
      const portalAddress = await smartFund.exchangePortal.call();
      const permittedExchangesAddress = await smartFund.permittedExchanges.call();
      eq(totalShares.toNumber(), 0);
      eq(portalAddress, exchangePortal.address);
      eq(permittedExchangesAddress, permittedExchanges.address);
    });
  });

  describe("Deposit", function() {
    beforeEach(deployContract);

    it("should not be able to deposit 0 Ether", async function() {
      await util.expectThrow(smartFund.deposit({ from: user1, value: 0 }));
    });

    it("should be able to deposit positive amount of Ether", async function() {
      await smartFund.deposit({ from: user1, value: 100 });
      eq(await smartBank.addressToShares.call(user1), DECIMALS);
      eq(await smartFund.calculateFundValue.call(), 100);
    });

    it("should accurately calculate empty fund value", async function() {
      eq((await smartBank.getAllTokenAddresses()).length, 1); // Ether is initial token
      eq((await smartFund.calculateFundValue()).toNumber(), 0);
    });
  });

  describe("Withdraw", function() {
    beforeEach(deployContract);

    it("should be able to withdraw all deposited funds", async function() {
      const totalShares = await smartBank.totalShares();
      eq(totalShares.toNumber(), 0);

      await smartFund.deposit({ from: user1, value: 100 });
      eq(await web3.eth.getBalance(smartBank.address).toNumber(), 100);
      await smartFund.withdraw(0, false, { from: user1 });
      eq(await web3.eth.getBalance(smartBank.address).toNumber(), 0);
    });

    it("should be able to withdraw percentage of deposited funds", async function() {
      let totalShares;

      totalShares = await smartBank.totalShares();
      eq(totalShares.toNumber(), 0);

      await smartFund.deposit({ from: user1, value: 100 });

      totalShares = await smartBank.totalShares();

      await smartFund.withdraw(5000, false, { from: user1 }); // 50.00%

      eq(await smartBank.totalShares(), totalShares / 2);
    });

    it("Convert assets to ETH when withdraw", async function() {
      await smartFund.deposit({ from: user1, value: 100 });
      // increase price of bat. Ratio of 1/2 means 1 eth = 1/2 bat
      await exchangePortal.setRatio(1, 1);

      const portalBat = 1000;
      // send BAT to kyber
      await bat.transfer(exchangePortal.address, portalBat, { from: user1 });

      // trade 100 ether (wei) for 100 bat
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      eq(await web3.eth.getBalance(exchangePortal.address).toNumber(), 100);

      const balanceBefore = await web3.eth.getBalance(user1).toNumber();

      await smartFund.withdraw(0, true, { from: user1 });
      eq(await web3.eth.getBalance(exchangePortal.address).toNumber(), 0);

      assert.notEqual(
        await web3.eth.getBalance(user1).toNumber(),
        balanceBefore
      );
    });

    it("should be able to withdraw deposited funds with multiple users", async function() {
      // deposit
      await smartFund.deposit({ from: user1, value: 100 });

      eq(await smartFund.calculateFundValue(), 100);
      await smartFund.deposit({ from: user2, value: 100 });
      eq(await smartFund.calculateFundValue(), 200);

      // withdraw
      let sfBalance;
      sfBalance = await web3.eth.getBalance(smartBank.address);
      eq(sfBalance, 200);

      await smartFund.withdraw(0, false, { from: user1 });
      sfBalance = await web3.eth.getBalance(smartBank.address);

      eq(sfBalance, 100);

      await smartFund.withdraw(0, false, { from: user2 });
      sfBalance = (await web3.eth.getBalance(smartBank.address)).toNumber();
      eq(sfBalance, 0);
    });
  });

  describe("Whitelist Investors", function() {
    beforeEach(deployContract);

    it("should not allow anyone to deposit when whitelist is empty and set", async function() {
      await smartFund.setWhitelistOnly(true);
      await util.expectThrow(smartFund.deposit({ from: user1, value: 100 }));
      await util.expectThrow(smartFund.deposit({ from: user2, value: 100 }));
    });

    it("should only allow whitelisted addresses to deposit", async function() {
      await smartFund.setWhitelistOnly(true);
      await smartFund.setWhitelistAddress(user1, true);
      await smartFund.deposit({ from: user1, value: 100 });

      await util.expectThrow(smartFund.deposit({ from: user2, value: 100 }));
      await smartFund.setWhitelistAddress(user2, true);
      await smartFund.deposit({ from: user2, value: 100 });

      eq(await smartBank.addressToShares.call(user1), DECIMALS);
      eq(await smartBank.addressToShares.call(user2), DECIMALS);

      await smartFund.setWhitelistAddress(user1, false);
      await util.expectThrow(smartFund.deposit({ from: user1, value: 100 }));
      await smartFund.setWhitelistOnly(false);
      await smartFund.deposit({ from: user1, value: 100 });

      const balance = await smartBank.addressToShares.call(user1);
      eq(balance.toNumber(), 2 * DECIMALS);
    });
  });

  describe("Trade (Kyber)", function() {
    beforeEach(deployContract);

    it("should be able to make a trade", async function() {
      // deposit
      await smartFund.deposit({ from: user1, value: 100 });
      await smartFund.deposit({ from: user2, value: 100 });

      const portalBat = 1000;

      // send BAT to kyber
      await bat.transfer(exchangePortal.address, portalBat, { from: user1 });

      eq(await bat.balanceOf(exchangePortal.address), portalBat);

      // trade 100 ether (wei) for 100 bat
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      eq(await bat.balanceOf(exchangePortal.address), 900);
      eq(await bat.balanceOf(smartBank.address), 100);

      const user1StartBAT = (await bat.balanceOf(user1)).toNumber();
      const user2StartBAT = (await bat.balanceOf(user2)).toNumber();

      // withdraw funds
      await smartFund.withdraw(0, false, { from: user1 });

      eq((await bat.balanceOf(smartBank.address)).toNumber(), 50);
      eq((await bat.balanceOf(user1)).toNumber(), user1StartBAT + 50);

      await smartFund.withdraw(0, false, { from: user2 });

      eq((await bat.balanceOf(smartBank.address)).toNumber(), 0);
      eq((await bat.balanceOf(user2)).toNumber(), user2StartBAT + 50);
    });
  });

  describe("Fund Manager", function() {
    beforeEach(() => deployContract(1500, 1000));

    it("should calculate fund manager and platform cut when no profits", async function() {
      const [
        fundManagerRemainingCut,
        fundValue,
        fundManagerTotalCut
      ] = await smartFund.calculateFundManagerCut();

      eq(fundManagerRemainingCut.toNumber(), 0);
      eq(fundValue.toNumber(), 0);
      eq(fundManagerTotalCut.toNumber(), 0);
    });

    const fundManagerTest = async (expectedFundManagerCut = 15) => {
      // deposit
      await smartFund.deposit({ from: user1, value: 100 });

      // 1 cot = 2 bat
      // await tokenOracle.setRate(bat.address, 2 * DECIMALS)

      // send BAT to kyber
      await bat.transfer(exchangePortal.address, 200, { from: user1 });

      // Trade 100 ether for 100 bat
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // increase price of bat. Ratio of 1/2 means 1 eth = 1/2 bat
      await exchangePortal.setRatio(1, 2);

      // check profit and cuts are corrects
      const [
        fundManagerRemainingCut,
        fundValue,
        fundManagerTotalCut
      ] = await smartFund.calculateFundManagerCut();

      eq(fundValue.toNumber(), 200);
      eq(fundManagerRemainingCut.toNumber(), expectedFundManagerCut);
      eq(fundManagerTotalCut.toNumber(), expectedFundManagerCut);
    };

    it("should calculate fund manager and platform cut correctly", async function() {
      await fundManagerTest();
    });

    it("should calculate fund manager and platform cut correctly when not set", async function() {
      await deployContract(0, 0);

      await fundManagerTest(0);
    });

    it("should calculate fund manager and platform cut correctly when no platform fee", async function() {
      await deployContract(1500, 0);

      await fundManagerTest(15);
    });

    it("should calculate fund manager and platform cut correctly when no success fee", async function() {
      await deployContract(0, 1000);

      await fundManagerTest(0);
    });

    it("should be able to withdraw fund manager profits", async function() {
      await deployContract(2000, 0);
      await fundManagerTest(20);

      await smartFund.fundManagerWithdraw(false, { from: user1 });

      const [
        fundManagerRemainingCut,
        fundValue,
        fundManagerTotalCut
      ] = await smartFund.calculateFundManagerCut();

      eq(fundValue.toNumber(), 180);
      eq(fundManagerRemainingCut.toNumber(), 0);
      eq(fundManagerTotalCut.toNumber(), 20);
    });
  });

  describe("Profit", function() {
    beforeEach(deployContract);

    it("should have zero profit before any deposits have been made", async function() {
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), 0);
      eq((await smartFund.calculateFundProfit()).toNumber(), 0);
    });

    it("should have zero profit before any trades have been made", async function() {
      await smartFund.deposit({ from: user1, value: 100 });
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), 0);
      eq((await smartFund.calculateFundProfit()).toNumber(), 0);
    });

    it("should accurately calculate profit if price stays stable", async function() {
      // give kyber network contract some money
      await bat.transfer(exchangePortal.address, 1000);

      // deposit in fund
      await smartFund.deposit({ from: user1, value: 100 });

      // make a trade with the fund
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // check that we still haven't made a profit
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), 0);
      eq((await smartFund.calculateFundProfit()).toNumber(), 0);
    });

    it("should accurately calculate profit upon price rise", async function() {
      // give kyber network contract some money
      await bat.transfer(exchangePortal.address, 1000);

      // deposit in fund
      await smartFund.deposit({ from: user1, value: 100 });

      // make a trade with the fund
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // change the rate (making a profit)
      await exchangePortal.setRatio(1, 2);

      // check that we have made a profit
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), 100);
      eq((await smartFund.calculateFundProfit()).toNumber(), 100);
    });

    it("should accurately calculate profit upon price fall", async function() {
      // give kyber network contract some money
      await bat.transfer(exchangePortal.address, 1000);

      // deposit in fund
      await smartFund.deposit({ from: user1, value: 100 });

      // Trade 100 eth for 100 bat via kyber
      await smartFund.trade(ETH_TOKEN_ADDRESS, 100, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // change the rate to make a loss (2 tokens is 1 ether)
      await exchangePortal.setRatio(2, 1);

      // check that we made negatove profit
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), -50);
      eq((await smartFund.calculateFundProfit()).toNumber(), -50);
    });

    it("should accurately calculate profit if price stays stable with multiple trades", async function() {
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 1000);
      await cot.transfer(exchangePortal.address, 1000);

      // deposit in fund
      await smartFund.deposit({ from: user1, value: 100 });

      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, cot.address, 0, [0, 0, 0], {
        from: user1
      });
      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // check that we still haven't made a profit
      eq((await smartFund.calculateFundProfit()).toNumber(), 0);
      eq((await smartFund.calculateAddressProfit(user1)).toNumber(), 0);
    });

    it("should accurately calculate profit and shares with multiple trades to and from eth (turned off rebalance)", async function() {
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 1000);
      await cot.transfer(exchangePortal.address, 1000);
      await exchangePortal.pay({ from: user1, value: 1000 });

      // disable rebalance
      // await smartFund.rebalanceToggle()

      // deposit in fund
      await smartFund.deposit({ from: user1, value: 100 });

      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, cot.address, 0, [0, 0, 0], {
        from: user1
      });
      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      // 1 token is now worth 2 ether, profit baby!
      await exchangePortal.setRatio(1, 2);

      // Now the value of the fund has doubled, user2 should have 1/3 of all shares
      await smartFund.deposit({ from: user2, value: 100 });

      // Make sure user1 has 2/3 of all shares and user2 has 1/3
      eq(await smartBank.addressToShares.call(user1), DECIMALS);
      eq(await smartBank.addressToShares.call(user2), 0.5 * DECIMALS);

      // Convert tokens back to ether, should have 300 ether afterwards
      await smartFund.trade(cot.address, 50, ETH_TOKEN_ADDRESS, 0, [0, 0, 0], {
        from: user1
      });
      await smartFund.trade(bat.address, 50, ETH_TOKEN_ADDRESS, 0, [0, 0, 0], {
        from: user1
      });

      // fund should have 300 eth now
      eq(await web3.eth.getBalance(smartBank.address), 300);

      // set the rate back to 1-1 and
      await exchangePortal.setRatio(1, 1);

      await smartFund.trade(ETH_TOKEN_ADDRESS, 300, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      const user1StartBAT = (await bat.balanceOf(user1)).toNumber();
      const user2StartBAT = (await bat.balanceOf(user2)).toNumber();

      await smartFund.withdraw(0, false, { from: user1 });
      await smartFund.withdraw(0, false, { from: user2 });

      eq((await bat.balanceOf(user1)) - 200, user1StartBAT);
      eq((await bat.balanceOf(user2)) - 100, user2StartBAT);
    });

    it("Fund manager should be able to withdraw after investor withdraws", async function() {
      // deploy smartFund with 10% success fee
      await deployContract(1000, 0);
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 50 * DECIMALS);
      await exchangePortal.pay({ from: user1, value: 3 * DECIMALS });
      // deposit in fund
      await smartFund.deposit({ from: user1, value: DECIMALS });

      eq(await web3.eth.getBalance(smartBank.address), DECIMALS);

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      eq(await web3.eth.getBalance(smartBank.address), 0);

      // 1 token is now worth 2 ether
      await exchangePortal.setRatio(1, 2);

      eq((await smartFund.calculateFundValue()).toNumber(), 2 * DECIMALS);

      // should receive 200 'ether' (wei)
      await smartFund.trade(
        bat.address,
        DECIMALS,
        ETH_TOKEN_ADDRESS,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      eq(await web3.eth.getBalance(smartBank.address), 2 * DECIMALS);

      // user1 now withdraws 190 ether, 90 of which are profit
      await smartFund.withdraw(0, false, { from: user1 });

      eq((await smartFund.calculateFundValue()).toNumber(), 0.1 * DECIMALS);

      const [
        fundManagerRemainingCut,
        fundValue,
        fundManagerTotalCut
      ] = await smartFund.calculateFundManagerCut();

      eq(fundValue.toNumber(), 0.1 * DECIMALS);
      eq(fundManagerRemainingCut.toNumber(), 0.1 * DECIMALS);
      eq(fundManagerTotalCut.toNumber(), 0.1 * DECIMALS);

      // FM now withdraws their profit
      await smartFund.fundManagerWithdraw(false, { from: user1 });
      eq((await web3.eth.getBalance(smartBank.address)).toNumber(), 0);
    });

    it("Should properly calculate profit after another user made profit and withdrew", async function() {
      // deploy smartFund with 10% success fee
      await deployContract(1000, 0);
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 50 * DECIMALS);
      await exchangePortal.pay({ from: user1, value: 5 * DECIMALS });
      // deposit in fund
      await smartFund.deposit({ from: user1, value: DECIMALS });

      eq(await web3.eth.getBalance(smartBank.address), DECIMALS);

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      eq(await web3.eth.getBalance(smartBank.address), 0);

      // 1 token is now worth 2 ether
      await exchangePortal.setRatio(1, 2);

      eq((await smartFund.calculateFundValue()).toNumber(), 2 * DECIMALS);

      // should receive 200 'ether' (wei)
      await smartFund.trade(
        bat.address,
        DECIMALS,
        ETH_TOKEN_ADDRESS,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      eq(await web3.eth.getBalance(smartBank.address), 2 * DECIMALS);

      // user1 now withdraws 190 ether, 90 of which are profit
      await smartFund.withdraw(0, false, { from: user1 });

      eq((await smartFund.calculateFundValue()).toNumber(), 0.1 * DECIMALS);

      // FM now withdraws their profit
      await smartFund.fundManagerWithdraw(false, { from: user1 });
      eq((await web3.eth.getBalance(smartBank.address)).toNumber(), 0);

      // now user2 deposits into the fund
      await smartFund.deposit({ from: user2, value: DECIMALS });

      // 1 token is now worth 1 ether
      await exchangePortal.setRatio(1, 1);

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      // 1 token is now worth 2 ether
      await exchangePortal.setRatio(1, 2);

      // should receive 200 'ether' (wei)
      await smartFund.trade(
        bat.address,
        DECIMALS,
        ETH_TOKEN_ADDRESS,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      const [
        fundManagerRemainingCut,
        fundValue,
        fundManagerTotalCut
      ] = await smartFund.calculateFundManagerCut();

      eq(fundValue.toNumber(), 2 * DECIMALS);
      eq(
        fundManagerRemainingCut.toNumber(),
        0.1 * DECIMALS,
        "remaining cut should be 0.1 eth"
      );
      eq(
        fundManagerTotalCut.toNumber(),
        0.2 * DECIMALS,
        "total cut should be 0.2 eth"
      );
    });
  });

  describe("Fund Manager profit cut with deposit/withdraw scenarios", function() {
    it("should accurately calculate shares when the manager makes a profit (turned off rebalance)", async function() {
      // deploy smartFund with 10% success fee
      await deployContract(1000, 0);
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // disable rebalance
      // await smartFund.rebalanceToggle()

      const user1StartBAT = (await bat.balanceOf(user1)).toNumber();

      // deposit in fund
      await smartFund.deposit({ from: user1, value: DECIMALS });

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      // 1 token is now worth 2 ether, the fund managers cut is now 0.1 ether
      await exchangePortal.setRatio(1, 2);

      await smartFund.deposit({ from: user2, value: DECIMALS });

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      await smartFund.fundManagerWithdraw(false);

      // This commented out line is what we would expect, but because of rounding issues we get
      // 49999999999672320 instead of 50000000000000000. Insignificant difference, but
      // this means after all shares are withdrawn from a smartFund there might be
      // negligible change leftover, perhaps we should have a method to withdraw that.

      // eq((await bat.balanceOf(user1)).toNumber() - user1StartBAT, 0.05 * DECIMALS)

      assert(
        Math.abs(
          (await bat.balanceOf(user1)).toNumber() -
            user1StartBAT -
            0.05 * DECIMALS
        ) <
          0.000001 * DECIMALS
      );

      await smartFund.withdraw(0, false, { from: user2 });

      eq((await bat.balanceOf(user2)).toNumber(), 0.5 * DECIMALS);
    });

    it("should accurately calculate shares when FM makes a loss then breaks even (turned off rebalance)", async function() {
      // deploy smartFund with 10% success fee
      await deployContract(1000, 0);
      // give exchange portal contract some money
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);
      await exchangePortal.pay({ from: user3, value: 3 * DECIMALS });

      // disable rebalance
      // await smartFund.rebalanceToggle()

      // deposit in fund
      await smartFund.deposit({ from: user2, value: DECIMALS });

      await smartFund.trade(
        ETH_TOKEN_ADDRESS,
        DECIMALS,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      // 1 token is now worth 1/2 ether, the fund lost half its value
      await exchangePortal.setRatio(2, 1);

      // user3 deposits, should have 2/3 of shares now
      await smartFund.deposit({ from: user3, value: DECIMALS });

      eq(await smartBank.addressToShares.call(user2), DECIMALS);
      eq(await smartBank.addressToShares.call(user3), 2 * DECIMALS);

      // 1 token is now worth 2 ether, funds value is 3 ether
      await exchangePortal.setRatio(1, 2);

      await smartFund.trade(
        bat.address,
        DECIMALS,
        ETH_TOKEN_ADDRESS,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      eq(
        (await web3.eth.getBalance(smartBank.address)).toNumber(),
        3 * DECIMALS
      );

      eq((await smartFund.calculateAddressProfit(user2)).toNumber(), 0);
      eq((await smartFund.calculateAddressProfit(user3)).toNumber(), DECIMALS);
    });
  });

  describe("SmartBank access permissions", function() {
    beforeEach(() => deployContract(1000, 0));

    // only FUND can call specific function in BANK
    // in all other cases it will error
    it("User can not call changeAddressToShares", async function() {
      await util.expectThrow(smartBank.changeAddressToShares(user2, 100, 1));
    });

    it("User can not call changeAddressesNetDeposit", async function() {
      await util.expectThrow(
        smartBank.changeAddressesNetDeposit(user2, 100, 1)
      );
    });

    it("User can not call changeTotalShares", async function() {
      await util.expectThrow(smartBank.changeTotalShares(100, 1));
    });

    it("User can not call increaseTotalEtherDeposited", async function() {
      await util.expectThrow(smartBank.increaseTotalEtherDeposited(100));
    });

    it("User can not call increaseTotalEtherWithdrawn", async function() {
      await util.expectThrow(smartBank.increaseTotalEtherWithdrawn(100));
    });

    it("User can not call increaseFundManagerCashedOut", async function() {
      await util.expectThrow(smartBank.increaseFundManagerCashedOut(100));
    });

    it("User can not call sendETH", async function() {
      //Send some ETH to BANK
      await web3.eth.sendTransaction({
        from: user1,
        to: smartBank.address,
        value: web3.toWei(2, "ether")
      });

      await util.expectThrow(smartBank.sendETH(user1, web3.toWei(1, "ether")));
    });

    it("User can not call sendTokens", async function() {
      // give exchange portal contract some tokens
      await bat.transfer(smartBank.address, 10 * DECIMALS);

      await util.expectThrow(
        smartBank.sendTokens(user1, 3 * DECIMALS, bat.address)
      );
    });

    it("User can not call tradeFromBank", async function() {
      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      await util.expectThrow(
        smartBank.tradeFromBank(
          ETH_TOKEN_ADDRESS,
          50,
          bat.address,
          0,
          [0, 0, 0],
          exchangePortal.address,
          {
            from: user1
          }
        )
      );
    });

    it("User can not call removeToken", async function() {
      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // deosit and trade for add token
      await smartFund.deposit({ from: user1, value: 100 });
      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      const BATbalance = await smartFund.getFundTokenHolding(bat.address);

      // Empty the balance for remove token
      await smartFund.trade(
        bat.address,
        BATbalance,
        ETH_TOKEN_ADDRESS,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      await util.expectThrow(smartBank.removeToken(bat.address, 1));
    });
  });

  describe("Reabalance", function() {
    beforeEach(() => deployContract(1000, 0));

    it("balance BAT should increase when we do second deposit after the purchase BAT", async function() {
      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);
      const BATbalance = await smartFund.getTokenValue(bat.address);

      // enable rebalance
      await smartFund.rebalanceToggle();

      await smartFund.deposit({ from: user1, value: 100 });
      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });
      const BATbalanceBefore = await smartFund.getTokenValue(bat.address);
      const ETHbalanceBefore = await web3.eth.getBalance(smartBank.address);

      assert.notEqual(BATbalanceBefore.toNumber(), BATbalance.toNumber());

      await smartFund.deposit({ from: user1, value: 100 });

      const BATbalanceAfter = await smartFund.getTokenValue(bat.address);
      const ETHbalanceAfter = await web3.eth.getBalance(smartBank.address);

      assert(BATbalanceBefore.toNumber() < BATbalanceAfter.toNumber());
      assert(ETHbalanceBefore.toNumber() < ETHbalanceAfter.toNumber());
    });

    it("Correct rebalance assets", async function() {
      // The more the asset rate in the ETH the more it gets when rebalance
      // in this case ETH should recive less ETH because bat more that ETH
      // cause we bay bat for the amount of 51 eth

      // 1 bat = 1 eth
      await exchangePortal.setRatio(1, 1);

      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // enable rebalance
      await smartFund.rebalanceToggle();

      await smartFund.deposit({ from: user1, value: 100 });
      await smartFund.trade(ETH_TOKEN_ADDRESS, 51, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      await smartFund.deposit({ from: user1, value: 100 });

      const balanceBat = await bat.balanceOf(smartBank.address);
      const balanceEth = await web3.eth.getBalance(smartBank.address);

      assert(balanceEth.toNumber() < balanceBat.toNumber());
    });

    it("Not owner fund can not call rebalanceToggle()", async function() {
      await util.expectThrow(smartFund.rebalanceToggle({ from: user2 }));
    });
  });

  describe("SmartBank concept", function() {
    beforeEach(() => deployContract(1000, 0));
    beforeEach(() =>
      newFundAndBank(1000, 0, exchangePortal, permittedExchanges));

    it("Owner BANK can change FUND in BANK", async function() {
      smartBank.changeFund(newSmartFund.address, { from: user1 });
      newSmartFund.changeBank(smartBank.address, { from: user1 });

      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // deposit and trade for test that all work good after change
      await newSmartFund.deposit({ from: user1, value: 100 });

      await newSmartFund.trade(
        ETH_TOKEN_ADDRESS,
        50,
        bat.address,
        0,
        [0, 0, 0],
        {
          from: user1
        }
      );

      await newSmartFund.deposit({ from: user1, value: 100 });
    });

    it("Owner FUND can change BANK in FUND", async function() {
      newSmartBank.changeFund(smartFund.address, { from: user1 });
      smartFund.changeBank(newSmartBank.address, { from: user1 });

      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // deposit and trade for test that all work good after change
      await smartFund.deposit({ from: user1, value: 100 });

      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      await smartFund.deposit({ from: user1, value: 100 });
    });

    it("FUND CAN NOT USE the new BANK, if the new BANK does not confirm the FUND", async function() {
      //smartBank.changeFund(newSmartFund.address, {from:user1})
      newSmartFund.changeBank(smartBank.address, { from: user1 });

      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      // deposit and trade for test that all work good after change
      // expectThrow now
      await util.expectThrow(newSmartFund.deposit({ from: user1, value: 100 }));

      await util.expectThrow(
        newSmartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
          from: user1
        })
      );

      await util.expectThrow(newSmartFund.deposit({ from: user1, value: 100 }));
    });

    it("Not Onwer of SmartBank can NOT change smartFund", async function() {
      await util.expectThrow(
        smartBank.changeFund(newSmartFund.address, { from: user2 })
      );
    });

    it("Not Owner of SmartFund can NOT change smartBank", async function() {
      await util.expectThrow(
        smartFund.changeBank(newSmartBank.address, { from: user2 })
      );
    });

    it("Balance in BANK increase after deposit in FUND, FUND no hold ETH", async function() {
      const bankBalanceBefore = await web3.eth.getBalance(smartBank.address);

      await smartFund.deposit({ from: user1, value: 100 });

      const bankBalanceAfter = await web3.eth.getBalance(smartBank.address);

      const fundBalance = await web3.eth.getBalance(smartFund.address);

      assert(bankBalanceBefore.toNumber() < bankBalanceAfter.toNumber());

      eq(fundBalance, 0);
    });

    it("Fund rebalance all assets in BANK, FUND no hold tokens", async function() {
      const batBalanceInBankBefore = await bat.balanceOf(smartBank.address);
      // give exchange portal contract some tokens
      await bat.transfer(exchangePortal.address, 10 * DECIMALS);

      await smartFund.deposit({ from: user1, value: 100 });

      await smartFund.trade(ETH_TOKEN_ADDRESS, 50, bat.address, 0, [0, 0, 0], {
        from: user1
      });

      await smartFund.deposit({ from: user1, value: 100 });

      const batBalanceInBankAfter = await bat.balanceOf(smartBank.address);

      const batBalanceInFund = await bat.balanceOf(smartFund.address);

      assert(
        batBalanceInBankBefore.toNumber() < batBalanceInBankAfter.toNumber()
      );

      eq(batBalanceInFund, 0);
    });
  });

  describe("ERC20 implementation", function() {
    beforeEach(() => deployContract(1000, 0));
    beforeEach(() =>
      newFundAndBank(1000, 0, exchangePortal, permittedExchanges));

    it("should be able to transfer shares to another user", async function() {
      await smartFund.deposit({ from: user2, value: 100 });
      eq((await smartFund.balanceOf(user2)).toNumber(), DECIMALS);

      await smartFund.transfer(user3, DECIMALS, { from: user2 });
      eq((await smartFund.balanceOf(user3)).toNumber(), DECIMALS);
      eq((await smartFund.balanceOf(user2)).toNumber(), 0);
    });

    it("should allow a user to withdraw their shares that were transfered to them", async function() {
      await smartFund.deposit({ from: user2, value: 100 });
      await smartFund.transfer(user3, DECIMALS, { from: user2 });
      eq((await smartFund.balanceOf(user3)).toNumber(), DECIMALS);
      await smartFund.withdraw(0, false, { from: user3 });
      eq((await smartFund.balanceOf(user3)).toNumber(), 0);
    });
  });
});
