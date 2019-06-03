pragma solidity ^0.4.23;

contract PermittedExchangesInterface {

  mapping (address => uint256) public exchangePermittedDate;

  mapping (address => bool) public permittedAddresses;
}
