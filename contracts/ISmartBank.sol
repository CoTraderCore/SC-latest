pragma solidity ^0.4.24;

import "./zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./ExchangePortalInterface.sol";

contract ISmartBank {

 uint256 public totalEtherDeposited;
 uint256 public totalEtherWithdrawn;
 uint256 public fundManagerCashedOut;
 uint256 public totalShares;

 mapping (address => int256) public addressesNetDeposit;
 mapping (address => uint256) public addressToShares;

 function tradeFromBank(
    ERC20 _source,
    uint256 _sourceAmount,
    ERC20 _destination,
    uint256 _type,
    bytes32[] _additionalArgs,
    ExchangePortalInterface exchangePortal
    )
    external
    returns(uint256);

  function tokensToETH(
     ERC20 _source,
     uint256 _sourceAmount,
     address _destAddress,
     bytes32[] _additionalArgs,
     ExchangePortalInterface exchangePortal
     )
     external
     returns(uint256);


  function TokensLength() external view returns (uint);

  function TokensAddressByIndex(uint _index) external view returns (address);

  function getAllTokenAddresses() external view returns (address[]);

  function removeToken(address _token, uint256 _tokenIndex) external;


  function sendETH(address _to, uint256 _value) external;

  function sendTokens(address _to, uint256 _value, ERC20 _token) external;


  function increaseTotalEtherDeposited(uint256 _value) external;

  function changeTotalShares(uint256 _value, uint _type) external returns(uint256);

  function changeAddressesNetDeposit(address _sender, uint256 _value, uint _type) external returns(int256);


  function changeAddressToShares(address _sender, uint256 _value, uint _type) external returns(uint256);

  function increaseTotalEtherWithdrawn(uint256 _value) external returns(uint256);

  function increaseFundManagerCashedOut(uint256 _value) external returns(uint256);

}
