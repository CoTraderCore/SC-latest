pragma solidity ^0.4.19;

import "../../node_modules/zeppelin-solidity/contracts/token/ERC20/StandardToken.sol";
import "../../node_modules/zeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "../../node_modules/zeppelin-solidity/contracts/crowdsale/Crowdsale.sol";
import "../../node_modules/zeppelin-solidity/contracts/crowdsale/validation/CappedCrowdsale.sol";
import "../../node_modules/zeppelin-solidity/contracts/crowdsale/validation/TimedCrowdsale.sol";
import "../../node_modules/zeppelin-solidity/contracts/crowdsale/emission/AllowanceCrowdsale.sol";

// WIP

/**
For vesting see:
https://github.com/aragon/aragon-network-token/blob/master/contracts/MiniMeIrrevocableVestedToken.sol
https://github.com/sirin-labs/crowdsale-smart-contract/blob/master/contracts/SirinVestingTrustee.sol

Only one beneficiary per contract:
import "../../node_modules/zeppelin-solidity/contracts/token/ERC20/TokenVesting.sol";
 */

contract CoTraderCrowdsale is CappedCrowdsale, TimedCrowdsale, AllowanceCrowdsale, Pausable {
  function CoTraderCrowdsale(
    uint256 _rate,
    address _wallet,
    ERC20 _token,
    uint256 _cap,
    uint256 _openingTime,
    uint256 _closingTime,
    address _tokenWallet
  )
    Crowdsale(_rate, _wallet, _token)
    CappedCrowdsale(_cap)
    TimedCrowdsale(_openingTime, _closingTime)
    AllowanceCrowdsale(_tokenWallet)
    public
  {
  }

  function buyVestedToken() payable public {

  }

  struct VestedTokens {
    uint256 value;
    uint256 start;
    uint256 cliff;
    uint256 end;
    uint256 transferred;
    bool revokable;
  }

  mapping (address => VestedTokens) internal addressToVesting;

  function claimUnclaimedTokens() public {
    uint256 unclaimed = getVestedUnclaimedBalance(msg.sender);

    VestedTokens storage v = addressToVesting[msg.sender];

    v.transferred = v.transferred.add(unclaimed);

    token.transfer(msg.sender, unclaimed);
  }

  function getTotalUnclaimedBalance(address _address) public view returns (uint256) {
    VestedTokens memory v = addressToVesting[_address];

    return v.value.sub(v.transferred);
  }

  function getVestedUnclaimedBalance(address _address) public view returns (uint256) {
    VestedTokens memory v = addressToVesting[_address];

    return getVestedAmount(_address).sub(v.transferred);
  }

  function getVestedAmount(address _address) public view returns (uint256) {
    VestedTokens memory v = addressToVesting[_address];

    uint256 duration = v.start.sub(v.end);
    /* solium-disable-next-line */
    uint256 timePassed = uint256(now).sub(v.start);
    
    return v.value.mul(timePassed).div(duration);
  }
}