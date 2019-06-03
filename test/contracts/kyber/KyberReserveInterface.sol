pragma solidity ^0.4.21;

import "../../../node_modules/zeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/// @title Kyber Reserve contract
interface KyberReserveInterface {
  function trade(
    ERC20 srcToken,
    uint srcAmount,
    ERC20 destToken,
    address destAddress,
    uint conversionRate,
    bool validate
  )
    public
    payable
    returns(bool);

  function getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint);
}
