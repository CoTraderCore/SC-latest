pragma solidity ^0.4.24;

import "./ExchangePortalInterface.sol";
import "./kyber/KyberNetworkInterface.sol";
import "./zeppelin-solidity/contracts/ownership/Ownable.sol";
import "./zeppelin-solidity/contracts/math/SafeMath.sol";
import "./zeppelin-solidity/contracts/token/ERC20/DetailedERC20.sol";

/*
* The ExchangePortal contract is an implementation of ExchangePortalInterface that allows
* SmartFunds to exchange and calculate their value via KyberNetwork
*/
contract ExchangePortal is ExchangePortalInterface, Ownable {
  using SafeMath for uint256;

  enum ExchangeType { Kyber }

  KyberNetworkInterface kyber;

  // KyberExchange recognizes ETH by this address
  ERC20 constant private ETH_TOKEN_ADDRESS = ERC20(0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee);

  mapping (address => bool) disabledTokens;

  event Trade(address trader, address src, uint256 srcAmount, address dest, uint256 destReceived, uint8 exchangeType);

  // Modifier to check that trading this token is not disabled
  modifier tokenEnabled(ERC20 _token) {
    require(!disabledTokens[address(_token)]);
    _;
  }

  /**
  * @dev contructor
  *
  * @param _kyber    Address of Kyber exchange to trade with
  */
  constructor(address _kyber) public {
    kyber = KyberNetworkInterface(_kyber);
  }

  /**
  * @dev Facilitates a trade for a SmartFund
  *
  * @param _source            ERC20 token to convert from
  * @param _sourceAmount      Amount to convert from (in _source token)
  * @param _destination       ERC20 token to convert to
  * @param _type              The type of exchange to trade with
  * @param _additionalArgs    Array of bytes32 additional arguments
  *
  * @return The amount of _destination received from the trade
  */
  function trade(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    uint256 _type,
    bytes32[] _additionalArgs
  )
    external
    payable
    tokenEnabled(_destination)
    returns (uint256)
  {

    require(_source != _destination);

    uint256 receivedAmount;

    if (_source == ETH_TOKEN_ADDRESS) {
      require(msg.value == _sourceAmount);
    } else {
      require(msg.value == 0);
    }

    if (_type == uint(ExchangeType.Kyber)) {
      uint256 maxDestinationAmount = uint256(_additionalArgs[0]);
      uint256 minConversionRate = uint256(_additionalArgs[1]);
      address walletId = address(_additionalArgs[2]);

      receivedAmount = _tradeKyber(
        _source,
        _sourceAmount,
        _destination,
        address(this),
        maxDestinationAmount,
        minConversionRate,
        walletId
      );
    } else {
      // unknown exchange type
      revert();
    }

    // Check if Ether was received
    if (_destination == ETH_TOKEN_ADDRESS) {
      (msg.sender).transfer(receivedAmount);
    } else {
      // transfer tokens received to sender
      _destination.transfer(msg.sender, receivedAmount);
    }

    // After the trade, any _source that exchangePortal holds will be sent back to msg.sender
    uint256 endAmount = (_source == ETH_TOKEN_ADDRESS) ? this.balance : _source.balanceOf(this);

    // Check if we hold a positive amount of _source
    if (endAmount > 0) {
      if (_source == ETH_TOKEN_ADDRESS) {
        (msg.sender).transfer(endAmount);
      } else {
        _source.transfer(msg.sender, endAmount);
      }
    }

    emit Trade(msg.sender, _source, _sourceAmount, _destination, receivedAmount, uint8(_type));

    return receivedAmount;
  }


  /**
  * @dev  allow Exchange and send for any destination address not only to msg.sender
  *
  * @notice helper for _rebalance and tokenToETH function, when we do rebalance from fund to bank
  * or if we do withdraw with onlyInETH
  *
  * @param _source            ERC20 token to convert from
  * @param _sourceAmount      Amount to convert from (in _source token)
  * @param _destination       ERC20 token to convert to
  * @param _destAddress       exchanged token reciver address
  * @param _additionalArgs    Array of bytes32 additional arguments
  *
  */
  function tradeForDest(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    address _destAddress,
    bytes32[] _additionalArgs
  )
    external
    payable
    returns (uint256)
  {
   require(_source != _destination);

   uint256 maxDestinationAmount = uint256(_additionalArgs[0]);
   uint256 minConversionRate = uint256(_additionalArgs[1]);
   address walletId = address(_additionalArgs[2]);

   uint256 receivedAmount;

   receivedAmount = _tradeKyber(
     _source,
     _sourceAmount,
     _destination,
     _destAddress,
     maxDestinationAmount,
     minConversionRate,
     walletId
   );
  }

  /**
  * @dev Facilitates a trade between this contract and KyberExchange
  *
  * @param _source                  ERC20 token to convert from
  * @param _sourceAmount            Amount to convert from (in _source token)
  * @param _destination             ERC20 token to convert to
  * @param _destAddress             ETH address of the recipient
  * @param _maxDestinationAmount    The maximum amount of _destination to receive in this trade
  * @param _minConversionRate       The minimum conversion rate we're willing to trade for
  * @param _walletId                Address of the wallet that will receive a cut of the trade
  *
  * @return The amount of _destination received from the trade
  */
  function _tradeKyber(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    address _destAddress,
    uint256 _maxDestinationAmount,
    uint256 _minConversionRate,
    address _walletId
  )
    private
    returns (uint256)
  {
    uint256 destinationReceived;

    if (_source == ETH_TOKEN_ADDRESS) {
      destinationReceived = kyber.trade.value(_sourceAmount)(
        _source,
        _sourceAmount,
        _destination,
        _destAddress,
        _maxDestinationAmount,
        _minConversionRate,
        _walletId
      );
    } else {
      _transferFromSenderAndApproveTo(_source, _sourceAmount, kyber);
      destinationReceived = kyber.trade(
        _source,
        _sourceAmount,
        _destination,
        _destAddress,
        _maxDestinationAmount,
        _minConversionRate,
        _walletId
      );
    }

    return destinationReceived;
  }

  /**
  * @dev Transfers tokens to this contract and approves them to another address
  *
  * @param _source          Token to transfer and approve
  * @param _sourceAmount    The amount to transfer and approve (in _source token)
  * @param _to              Address to approve to
  */
  function _transferFromSenderAndApproveTo(ERC20 _source, uint256 _sourceAmount, address _to) private {
    require(_source.transferFrom(msg.sender, this, _sourceAmount));

    _source.approve(_to, _sourceAmount);
  }

  /**
  * @dev Gets the value of a given amount of some token
  *
  * @param _from      Address of token we're converting from
  * @param _to        Address of token we're getting the value in
  * @param _amount    The amount of _from
  *
  * @return The value of `_amount` amount of _from in terms of _to
  */
  function getValue(address _from, address _to, uint256 _amount) public view returns (uint256) {
    (uint256 expectedRate, ) = kyber.getExpectedRate(ERC20(_from), ERC20(_to), _amount);
    uint256 value = expectedRate * _amount / (10 ** uint256(DetailedERC20(_from).decimals()));

    return value;
  }

  /**
  * @dev Gets the total value of array of tokens and amounts
  *
  * @param _fromAddresses    Addresses of all the tokens we're converting from
  * @param _amounts          The amounts of all the tokens
  * @param _to               The token who's value we're converting to
  *
  * @return The total value of _fromAddresses and _amounts in terms of _to
  */
  function getTotalValue(address[] _fromAddresses, uint256[] _amounts, address _to) public view returns (uint256) {
    uint256 sum = 0;

    for (uint256 i = 0; i < _fromAddresses.length; i++) {
      sum = sum.add(getValue(_fromAddresses[i], _to, _amounts[i]));
    }

    return sum;
  }

  /**
  * @dev Allows the owner to disable/enable the buying of a token
  *
  * @param _token      Token address whos trading permission is to be set
  * @param _enabled    New token permission
  */
  function setToken(address _token, bool _enabled) external onlyOwner {
    disabledTokens[_token] = _enabled;
  }

  // fallback payable function to receive ether from other contract addresses
  function() public payable {}

}
