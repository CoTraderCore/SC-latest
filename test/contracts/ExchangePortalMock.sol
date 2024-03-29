pragma solidity ^0.4.24;

import "../../contracts/ExchangePortalInterface.sol";
import "../../contracts/zeppelin-solidity/contracts/math/SafeMath.sol";
import "../../contracts/zeppelin-solidity/contracts/token/ERC20/ERC20.sol";

// Exchange Portal Mock,
contract ExchangePortalMock is ExchangePortalInterface {

  enum ExchangeType { Kyber }

  using SafeMath for uint256;

  // KyberExchange recognizes ETH by this address, airswap recognizes ETH as address(0x0)
  ERC20 constant private ETH_TOKEN_ADDRESS = ERC20(0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee);
  address constant private NULL_ADDRESS = address(0);
  // multiplyer and divider are used to set prices. X ether = X*(mul/div) token,
  // similarly X token = X*(div/mul) ether for every token where X is the amount
  uint256 public mul;
  uint256 public div;

  event Trade(address trader, address src, uint256 srcAmount, address dest, uint256 destReceived, uint8 exchangeType);

  constructor(uint256 _mul, uint256 _div) public {
    mul = _mul;
    div = _div;
  }

  function trade(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    uint256 _type,
    bytes32[] _additionalArgs
  ) external payable returns (uint256) {
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

    emit Trade(msg.sender, _source, _sourceAmount, _destination, receivedAmount, uint8(_type));

    return receivedAmount;
  }

  // Imitation
  // Work correct with ration 1 to 1
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
   uint256 receivedAmount;
   uint256 maxDestinationAmount = uint256(_additionalArgs[0]);
   uint256 minConversionRate = uint256(_additionalArgs[1]);
   address walletId = address(_additionalArgs[2]);

   receivedAmount = _tradeKyber(
       _source,
       _sourceAmount,
       _destination,
       maxDestinationAmount,
       minConversionRate,
       walletId
   );
   if(_destination == ETH_TOKEN_ADDRESS){
     _destAddress.transfer(_sourceAmount);
   }else{
     // transfer tokens received to sender
     _destination.transfer(_destAddress, _sourceAmount);
   }
   // transfer tokens received to sender
   // _destination.transfer(_destAddress, _sourceAmount);
   return receivedAmount;
  }


  function _tradeKyber(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    uint256 _maxDestinationAmount,
    uint256 _minConversionRate,
    address _walletId
  )
    private
    returns (uint256)
  {
    uint256 destinationReceived;

    if (_source == ETH_TOKEN_ADDRESS) {
      destinationReceived = getKyberValue(_source, _destination, _sourceAmount);
    } else {
      _transferFromSenderAndApproveTo(_source, _sourceAmount, NULL_ADDRESS);
      destinationReceived = getKyberValue(_source, _destination, _sourceAmount);
    }

    return destinationReceived;
  }

  function _transferFromSenderAndApproveTo(ERC20 _source, uint256 _sourceAmount, address _to) private {
    require(_source.transferFrom(msg.sender, this, _sourceAmount));

    _source.approve(_to, _sourceAmount);
  }

  function getValue(address _from, address _to, uint256 _amount) public view returns (uint256) {
    uint256 kyberValue = getKyberValue(_from, _to, _amount);

    return kyberValue;
  }

  // Possibilities:
  // * kyber.getExpectedRate
  // * kyber.findBestRate
  function getKyberValue(address _from, address _to, uint256 _amount) public view returns (uint256) {
    if (_to == address(ETH_TOKEN_ADDRESS)) {
      return _amount.mul(div).div(mul);
    } else if (_from == address(ETH_TOKEN_ADDRESS)) {
      return _amount.mul(mul).div(div);
    } else {
      return _amount;
    }
  }

  // get the total value of multiple tokens and amounts in one go
  function getTotalValue(address[] _fromAddresses, uint256[] _amounts, address _to) public view returns (uint256) {
    uint256 sum = 0;

    for (uint256 i = 0; i < _fromAddresses.length; i++) {
      sum = sum.add(getValue(_fromAddresses[i], _to, _amounts[i]));
    }

    return sum;
  }

  function setRatio(uint256 _mul, uint256 _div) public {
    mul = _mul;
    div = _div;
  }

  function pay() public payable {}

  function() public payable {}
}
