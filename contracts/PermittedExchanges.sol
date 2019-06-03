pragma solidity ^0.4.24;

import "./PermittedExchangesInterface.sol";
import "./zeppelin-solidity/contracts/ownership/Ownable.sol";

/*
  The PermittedExchanges contract determines which addresses are permitted (for a SmartFund to
  connect to), and allows new addresses to be permitted after a 3 day timeout, during which the
  public can audit the new contract to ensure that it does not allow the fund manager or platform
  owner to act maliciously with the funds holdings. The 3 day timeout can also be changes, albeit
  with a 3 day timeout as well, in order to be publicly accountable and transparent.
*/
contract PermittedExchanges is PermittedExchangesInterface, Ownable {

  event NewExchangePending(address newExchange, uint256 permittedDate);

  event NewExchangeEnabled(address newExchange, bool enabled);

  event NewWaitTimePending(uint256 newWaitTime, uint256 permittedDate);

  event NewWaitTimeSet(uint256 newWaitTime);

  // The amount of waiting time for a new Exchange Portal to be permitted
  uint256 public newExchangeWaitTime = 3 days;

  // New waiting time for new exchange portal to be permitted
  uint256 public newWaitTime;

  // The date at which the new wait time can be set
  uint256 public newWaitTimeUpgradeDate;

  // Bool representing whether we're in the process of updating the waiting time
  bool public settingNewWaitTime = false;

  // Mapping from address to the time it will be permitted
  mapping (address => uint256) public exchangePermittedDate;

  // Mapping to permitted ExchangePortal addresses
  mapping (address => bool) public permittedAddresses;

  /**
  * @dev contructor
  *
  * @param _address    The initial Exchange address to be permitted
  */
  constructor(address _address) public {
    _enableAddress(_address, true);
  }

  /**
  * @dev Begins the waiting process of adding a new exchange address to permittedExchanges
  *
  * @param _newAddress   The address of the new exchange portal to permit
  */
  function startNewExchangeProcess(address _newAddress) public onlyOwner {
    // Make sure this process hasn't started yet for the new Exchange
    require(exchangePermittedDate[_newAddress] == 0);

    // Set the permitted date to be newExchangeWaitTime from now
    // solium-disable-next-line security/no-block-members
    exchangePermittedDate[_newAddress] = now + newExchangeWaitTime;

    // solium-disable-next-line security/no-block-members
    emit NewExchangePending(_newAddress, now + newExchangeWaitTime);
  }

  /**
  * @dev Completes the process of adding a new exchange to permittedAddresses
  *
  * @param _newAddress    The new address to permit
  */
  function completeNewExchangeProcess(address _newAddress) public onlyOwner {
    // Check that the required amount of time has passed
    // solium-disable-next-line security/no-block-members
    require(exchangePermittedDate[_newAddress] > now);

    // Set the exchange as permitted
    _enableAddress(_newAddress, true);
  }

  /**
  * @dev Begins the process of setting a new waiting time for updating permitted addresses
  *
  * @param _waitTime    The new waiting time to be set
  */
  function startNewWaitTimeProcess(uint256 _waitTime) public onlyOwner {
    // Setting the new time upgrade date to be newExchangeWaitTime from now
    // solium-disable-next-line security/no-block-members
    newWaitTimeUpgradeDate = now + newExchangeWaitTime;

    settingNewWaitTime = true;

    newWaitTime = _waitTime;

    // solium-disable-next-line security/no-block-members
    emit NewWaitTimePending(_waitTime, now + newExchangeWaitTime);
  }

  /**
  * @dev Completes the process of setting a new waiting time
  */
  function completeNewWaitTimeProcess() public onlyOwner {
    // Make sure that we're in the process of updating the pending period
    require(settingNewWaitTime);

    // Check that the required amount of time has passed
    // solium-disable-next-line security/no-block-members
    require(now > newWaitTimeUpgradeDate);

    // Setting the new exchange pending time to the new one
    newExchangeWaitTime = newWaitTime;

    // Setting the updating process as false
    settingNewWaitTime = false;

    emit NewWaitTimeSet(newWaitTime);
  }

  /**
  * @dev Disables an address, meaning SmartFunds will no longer be able to connect to them
  * if they're not already connected
  *
  * @param _newAddress    The address to disable
  */
  function disableAddress(address _newAddress) public onlyOwner {
    _enableAddress(_newAddress, false);
  }

  /**
  * @dev Enables/disables an address
  *
  * @param _newAddress    The new address to set
  * @param _enabled       Bool representing whether or not the address will be enabled
  */
  function _enableAddress(address _newAddress, bool _enabled) private {
    permittedAddresses[_newAddress] = _enabled;

    emit NewExchangeEnabled(_newAddress, _enabled);
  }
}
