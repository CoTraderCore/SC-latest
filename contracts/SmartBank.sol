pragma solidity ^0.4.24;

/*
 SmartBank use as a tokens storage for SmartFund
 All trade operation are performed in SmartFund, but tokens for this operation,
 SmartFund get from SmartBank.

 Motivation
 SmartBank help with abstarction, if we do update in App, users do not need,
 transfer tokens from old smartFund version to new smartFund version.
 User just set new SmartFund in SmartBank.
*/

import "./zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./zeppelin-solidity/contracts/ownership/Ownable.sol";
import "./zeppelin-solidity/contracts/math/SafeMath.sol";
import "./ExchangePortalInterface.sol";

contract SmartBank is Ownable{

  using SafeMath for uint256;

  // fund address and bool state
  address public fund;
  bool public isFundSet = false;

  // An array of all the erc20 token addresses the smart fund holds
  address[] public tokenAddresses;
  // ETH Token
  ERC20 constant private ETH_TOKEN_ADDRESS = ERC20(0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee);
  // so that we can easily check that we don't add duplicates to our array
  mapping (address => bool) public tokensTraded;

  // Total amount of ether deposited by all users
  uint256 public totalEtherDeposited = 0;

  // The maximum amount of tokens that can be traded via the smart fund
  uint256 public MAX_TOKENS = 50;

  // the total number of shares in the BANK
  uint256 public totalShares = 0;

  // how many shares belong to each address
  mapping (address => uint256) public addressToShares;

  // this is really only being used to more easily show profits, but may not be necessary
  // if we do a lot of this offchain using events to track everything
  // total `depositToken` deposited - total `depositToken` withdrawn
  mapping (address => int256) public addressesNetDeposit;

  // Total amount of ether withdrawn by all users
  uint256 public totalEtherWithdrawn = 0;

  // The earnings the fund manager has already cashed out
  uint256 public fundManagerCashedOut = 0;

  event SmartFundWasChanged(address indexed smartFundAddress, address indexed smartBankAddress);



  /**
   * @dev Throws if called by any other address
   */
  modifier onlyFund() {
    require(msg.sender == fund);
    _;
  }

  /**
  * @dev constructor
  *
  * @param _owner                        Address of the fund manager
  */

  constructor(address _owner, address _fund){

    // set owners
    if (_owner == address(0))
      owner = msg.sender;
    else
      owner = _owner;

    // initialize fund
    fund = _fund;
    isFundSet = true;

    // Initial Token is Ether
    tokenAddresses.push(address(ETH_TOKEN_ADDRESS));
  }

  /**
  * @dev onwer can change FUND
  */

  function changeFund(address _fund) public onlyOwner{
    fund = _fund;

    isFundSet = true;

    emit SmartFundWasChanged(_fund, address(this));
  }

  /**
  * @dev Facilitates a trade of the funds holdings via the exchange portal
  *
  * @param _source            ERC20 token to convert from
  * @param _sourceAmount      Amount to convert (in _source token)
  * @param _destination       ERC20 token to convert to
  * @param _type              The type of exchange to trade with
  * @param _additionalArgs    Array of bytes32 additional arguments
  * @param exchangePortal     exchange Portal
  */
  function tradeFromBank(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    uint256 _type,
    bytes32[] _additionalArgs,
    ExchangePortalInterface exchangePortal
    ) public
    onlyFund
    returns(uint256)
    {

    uint256 receivedAmount;

    if (_source == ETH_TOKEN_ADDRESS) {
      // Make sure we set fund
      require(isFundSet);
      // Make sure BANK contains enough ether
      require(this.balance >= _sourceAmount);
      // Call trade on ExchangePortal along with ether
      receivedAmount = exchangePortal.trade.value(_sourceAmount)(
        _source,
        _sourceAmount,
        _destination,
        _type,
        _additionalArgs
      );
    } else {
      _source.approve(exchangePortal, _sourceAmount);
      receivedAmount = exchangePortal.trade(
        _source,
        _sourceAmount,
        _destination,
        _type,
        _additionalArgs
      );
    }

    if (receivedAmount > 0)
      _addToken(_destination);

    return receivedAmount;
  }

  /**
  * @dev onlyFund can convert ERC20 to ETH and send to reciver address
  *
  * @param _source            ERC20 token to convert from
  * @param _sourceAmount      Amount to convert (in _source token)
  * @param _destAddress       ETH address who recive converted ETH
  * @param _additionalArgs    Array of bytes32 additional arguments
  * @param exchangePortal     exchange Portal
  */
  function tokensToETH(
    ERC20 _source,
    uint256 _sourceAmount,
    address _destAddress,
    bytes32[] _additionalArgs,
    ExchangePortalInterface exchangePortal
    ) public
    onlyFund
    returns(uint256)
    {
    uint256 receivedAmount;
    // We don't need convert ETH to ETH
    require(_source != ETH_TOKEN_ADDRESS);

    _source.approve(exchangePortal, _sourceAmount);
    receivedAmount = exchangePortal.tradeForDest.value(0)(
        _source,
        _sourceAmount,
        ETH_TOKEN_ADDRESS,
        _destAddress,
        _additionalArgs
      );

    return receivedAmount;
  }

  /**
  * @dev Adds a token to tokensTraded if it's not already there
  * @param _token    The token to add
  */
  function _addToken(address _token) private {
    // don't add token to if we already have it in our list
    if (tokensTraded[_token] || (_token == address(ETH_TOKEN_ADDRESS)))
      return;

    tokensTraded[_token] = true;
    uint256 tokenCount = tokenAddresses.push(_token);

    // we can't hold more than MAX_TOKENS tokens
    require(tokenCount <= MAX_TOKENS);
  }

  /**
  * @dev Fund can remove token from tokensTraded in bank
  *
  * @param _token         The address of the token to be removed
  * @param _tokenIndex    The index of the token to be removed
  *
  */
  function removeToken(address _token, uint256 _tokenIndex) public onlyFund {
    require(tokensTraded[_token]);
    require(ERC20(_token).balanceOf(this) == 0);
    require(tokenAddresses[_tokenIndex] == _token);

    tokensTraded[_token] = false;

    // remove token from array
    uint256 arrayLength = tokenAddresses.length - 1;
    tokenAddresses[_tokenIndex] = tokenAddresses[arrayLength];
    delete tokenAddresses[arrayLength];
    tokenAddresses.length--;
  }


  /**
  * @dev Fund can send ETH from BANK via Interface
  * @param _value ETH value in wei
  */
  function sendETH(address _to, uint256 _value) public onlyFund{
    // TODO add add check balance ETH and  allowance modifiers
    _to.transfer(_value);
  }

  /**
  * @dev Fund can send tokens from BANK via Interface
  * @param _value ETH value in wei
  */
  function sendTokens(address _to, uint256 _value, ERC20 _token) public onlyFund{
    // TODO add and balance and allowance modifiers
    _token.transfer(_to, _value);
  }


  /**
  * @dev Fund can change addressToShares mapping by address sender in Bank
  *
  * @return new value of addressToShares mapping by address sender after change
  *
  * @param _type 1 - add 0 - sub
  */
  function changeAddressToShares(address _sender, uint256 _value, uint _type) public onlyFund returns(uint256) {
    if(_type == 1){
      addressToShares[_sender] = addressToShares[_sender].add(_value);
    }else if(_type == 0){
      addressToShares[_sender] = addressToShares[_sender].sub(_value);
    }
    else {
      revert();
    }
    return addressToShares[_sender];
  }


  /**
  * @dev Fund can change addressesNetDeposit mapping by address sender in Bank
  *
  * @return new value of addressesNetDeposit mapping by address sender after change
  *
  * @param _type 1 - add 0 - sub
  */
  function changeAddressesNetDeposit(address _sender, uint256 _value, uint _type) public onlyFund returns(int256) {
    if(_type == 1){
      addressesNetDeposit[_sender] += int256(_value);
    }else if(_type == 0){
      addressesNetDeposit[_sender] -= int256(_value);
    }else{
      revert();
    }
    return addressesNetDeposit[_sender];
  }


  /**
  * @dev Fund can increase or decrease totalShares var in Bank
  *
  * @return new value of totalShares after increase or decrease
  *
  * @param _type 0 - sub 1 - ad
  */
  function changeTotalShares(uint256 _value, uint _type) public onlyFund returns(uint256) {
    if(_type == 1){
      totalShares = totalShares.add(_value);
    }else if(_type == 0){
      totalShares = totalShares.sub(_value);
    }else{
      revert();
    }
    return totalShares;
  }


  /**
  * @dev Fund can increase totalEtherDeposited var in Bank after deposit
  *
  * @return new value of totalEtherDeposited after increase
  */
  function increaseTotalEtherDeposited(uint256 _value) public onlyFund returns(uint256) {
    totalEtherDeposited = totalEtherDeposited.add(_value);
    return totalEtherDeposited;
  }


  /**
  * @dev view all tokens address in Bank
  */
  function getAllTokenAddresses() public view returns (address[]) {
    return tokenAddresses;
  }

  /**
  * @dev Fund can increase totalEtherWithdrawn var in Bank after windraw in Fund
  *
  * @return new value of totalEtherWithdrawn after increase
  */
  function increaseTotalEtherWithdrawn(uint256 _value) public onlyFund returns(uint256) {
    totalEtherWithdrawn = totalEtherWithdrawn.add(_value);
    return totalEtherWithdrawn;
  }


  /**
  * @dev Fund can increase fundManagerCashedOut var in Bank after windraw in Fund
  *
  * @return new value of fundManagerCashedOut after increase
  */
  function increaseFundManagerCashedOut(uint256 _value) public onlyFund returns(uint256) {
    fundManagerCashedOut = fundManagerCashedOut.add(_value);
    return fundManagerCashedOut;
  }

  // Fallback payable function in order to be able to receive ether from other contracts
  function() public payable {}
}
