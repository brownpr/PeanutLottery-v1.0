// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import {
    ISuperfluid,
    ISuperToken,
    ISuperAgreement,
    ISuperApp,
    SuperAppDefinitions
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";


import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { 
    IInstantDistributionAgreementV1 
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";

/*
@dev importing openzepplin protocols 
*/

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

///@dev import ERC20 token
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PeanutLottery is Ownable, ISuperApp {
    //using SafeMath for uint256;
    
    ///@dev Error defining
    string constant private _err_SafeMathsDivision = "SafeMath.sol Error: divission by zero";
    string constant private _err_noTicket = "peanutLottery: You need a ticket to enter lottery";
    string constant private _err_insuficientSteamSize = "peanutLottery: Stream size must be greater than $10";
    string constant private _err_needToBeWinner = "peanutLottery: need to be in winners pool to purchase";

    /// @dev entrance fee for game set to $1 
    uint256 constant private _entranceFee = 1e18;
    /// @dev Minimum stream size (flow rate)
    int96 constant private _MINIMUN_GAME_STREAM_RATE = int96(uint256(10e18)/uint256(3600*24*30));
    ///@dev power up fee, 1 peanut to trigger event
    uint constant private _powerUpFee = 1e18;
    ///@dev variable to allow user to remain in winners pool
    uint8 private _ignoreDraw;


    ///@dev burned peanuts go to 0x0 address
    address private burnerAddress = address(0);
    uint private _burnedPeanuts;

    ///@dev timestamp variables
    uint public gameLaunchTime;
    uint private _lastTimeStamp;



    ISuperfluid private _host; // host
    IConstantFlowAgreementV1 private _cfa; // Stored constant flow agreement class address 
    ISuperToken private _acceptedToken; // Accepted Token
    

    IERC20 private _peanutToken; // underlying unwrapped peanuts
    address private _superPeanut; // superPeanut address, wrapped by superfluid
    
    uint32 public constant INDEX_ID = 0;
    IInstantDistributionAgreementV1 private _ida;
    
    
    ///@dev using enumerableSet to store addresses 
    EnumerableSet.AddressSet private _playersSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    ///@dev winner address
    address private _winner;


    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        IInstantDistributionAgreementV1 ida,
        ISuperToken acceptedToken,
        IERC20 peanutToken
        ) 
    {
        assert(address(host) != address(0));
        assert(address(cfa) != address(0));
        assert(address(acceptedToken) != address(0));
        assert(address(peanutToken) != address(0));

        _host = host;
        _cfa = cfa;
        _ida = ida;
        _acceptedToken = acceptedToken;
        _peanutToken = peanutToken;

        //create the superPeanut contract;
        (_superPeanut , ) = _host.getERC20Wrapper(
            _peanutToken,
            "NUTS"
        );
        
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.createIndex.selector,
                _superPeanut,
                INDEX_ID,
                new bytes(0)
            )
        );

        uint256 configWord = SuperAppDefinitions.TYPE_APP_FINAL;

        _host.registerApp(configWord);

        ///@dev game launch times for peanut calcultations
        gameLaunchTime = block.timestamp;
        _lastTimeStamp = block.timestamp;

        _ignoreDraw = 0;

    }

    /// @dev Tickets by users
    mapping (address => uint) public tickets;

    /* ----------------------
        GAME DEFINITION
       ----------------------
    */

    ///@dev function that charges user entrance fee and gies them a ticket
    function enterPool(bytes calldata ctx) external {
        //Context has msg.sender encoded within
        (,,address sender,,) = _host.decodeCtx(ctx);
        _acceptedToken.transferFrom(sender, address(this), _entranceFee);
        tickets[sender]++;
    }


    ///@dev 
    function currentWinner() external view returns (
        uint256 drawingTime,
        address player,
        int96 streamSize
    ) {
        if (_winner != address(0)) {
            (drawingTime, streamSize,,) = _cfa.getFlow(_acceptedToken, address(this), _winner);
            player = _winner;
        }
    }

    //event for when winner changes 
    event WinnerChanged(address winner);
    //event for when winner uses a ignoreDraw peanUp
    event WinnerUnchanged(address winner);

    //event when peanuts harvested STILL NEEDS WORK
    //event PeanutsHarvest();

    ///@dev ensure user meet requirement before playing game
    function _meetRequirements(
        bytes calldata ctx
    ) 
        private view 
        returns (bytes memory cbdata) 
    {
            (,,address sender,,) = _host.decodeCtx(ctx);
            require(tickets[sender] > 0, _err_noTicket);
            cbdata = abi.encode(sender);
    }


    ///@dev Gameplay
    function _play(
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    ) 
        private 
        returns (bytes memory newCtx)
    {
        (address player) = abi.decode(cbdata, (address));

        (,int96 streamSize,,) = IConstantFlowAgreementV1(agreementClass).getFlowByID(_acceptedToken,agreementId);
        require(streamSize >= _MINIMUN_GAME_STREAM_RATE, _err_insuficientSteamSize);

        _playersSet.add(player);

        //Remove one ticket form user
        tickets[player]--;

        return _draw(player, ctx);
    }

    ///@dev remove player qhen they leave pool 
    function _quit(
        bytes calldata ctx
    ) 
        private 
        returns (bytes memory newCtx)
    {
        (,,address player,,) = _host.decodeCtx(ctx);

        _playersSet.remove(player);
        //_updatePeanutAllocation(player);
        
        return _draw(player, ctx);
    }

    function _draw(
        address player,
        bytes calldata ctx
    )
        private
        returns (bytes memory newCtx)
    {
        //_distributeHarvest();
        //_updatePeanutAllocation(player);

        address oldWinner = _winner;
        if (_ignoreDraw == 0) {

            if (_playersSet.length() > 0) {
                //not ideal RNG 
                //can be manipulated by miner 
                _winner = _playersSet.at(
                    uint(keccak256(abi.encodePacked(
                        player,
                        _playersSet.length(),
                        blockhash(block.number - 1), 
                        block.timestamp
                    ))) 
                    %
                    _playersSet.length()
            
                );


            } else {
                _winner = address(0);
            }

            newCtx = ctx;

            //remove old stream winner 
            if (oldWinner != address(0)) {
                (newCtx,) = _host.callAgreementWithContext(
                    _cfa,
                    abi.encodeWithSelector(
                        _cfa.deleteFlow.selector,
                        _acceptedToken,
                        address(this),
                        oldWinner,
                        new bytes(0)
                    ),
                    newCtx
                );
            }

            //create stream to new winner
            if (_winner !=address(0)) {
                (newCtx,) = _host.callAgreementWithContext(
                    _cfa,
                    abi.encodeWithSelector(
                        _cfa.createFlow.selector,
                        _acceptedToken,
                        _winner,
                        _cfa.getNetFlow(_acceptedToken, address(this)),
                        new bytes(0)
                    ),
                    newCtx
                );
            }


            emit WinnerChanged(_winner);
        } else {
            //remove one ignoreDraw
            _ignoreDraw--;
            emit WinnerUnchanged(_winner);

        }
    }


    /* -----------------------------
        PEANUT FACTORY
    --------------------------------*/

    ///@dev function to give farmers their fair share 
    function _updatePeanutAllocation(address farmer) private {
        // here we should give the user some units in the IDA based on their total stream size
        (,int96 totalStreamSize,,) = _cfa.getFlow(_acceptedToken, farmer, address(this));        
        uint128 currentUnits;

        // here we give the farmer the appropriate amount of peanutAllocation (units) based on their stream
        (,currentUnits,) = _ida.getSubscription(ISuperToken(_superPeanut), address(this), INDEX_ID, farmer);
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.updateSubscription.selector,
                ISuperToken(_superPeanut),
                INDEX_ID,
                farmer,
                totalStreamSize,
                new bytes(0)
            )
        );
        
    }

    ///@dev Function that wraps peanuts into superPeanuts when called, 1 per second since last called. 
    function _harvestAmount() view public returns(uint _peanutsToHarvest){
        _peanutsToHarvest = block.timestamp - _lastTimeStamp;
    }

    ///@dev Function to distributed peanuts to all users after _draw is run
    function _distributeHarvest()
        private
    {
        uint peanutQuantity = _harvestAmount();
        //update _lastTimeStamp
        _lastTimeStamp = block.timestamp;
        ///@dev If no peanuts are ready for harvest, return
        if(peanutQuantity == 0) {return;}
        //harvest the peanuts
        ISuperToken(_superPeanut).upgrade(peanutQuantity);
        //to avoid leftovers, collect peanutAmount
        uint peanutAmount = ISuperToken(_superPeanut).balanceOf(address(this));
        // check exactly how much we should distribute (there is a precision issue so need this extra function)
        (uint256 actualPeanutAmount,) = _ida.calculateDistribution(
            ISuperToken(_superPeanut),
            address(this), 
            INDEX_ID,
            peanutAmount);
          
        // distribute the peanuts to everyone subscribed to the INDEX_ID
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.distribute.selector,
                _superPeanut,
                INDEX_ID,
                actualPeanutAmount,
                new bytes(0)
            )
        );
    }

    //return number of burnedPeanuts
    function burnedNuts() view public returns(uint numberOfBurnedNuts){
        return numberOfBurnedNuts = _burnedPeanuts;
    }

    //return number of ignore draws
    function ignoreTokens() view public returns(uint ignoreDrawTokens){
        return ignoreDrawTokens = _ignoreDraw;
    }
        

    /* -----------------------------------
            PeanUPS - Peanut Power ups
    --------------------------------------*/
    
    function triggerEvent(
        bytes calldata ctx
    ) external
    returns(bytes memory newCtx) 
    {
        (,,address sender,,) = _host.decodeCtx(ctx);
        _acceptedToken.transferFrom(sender, address(this), _powerUpFee);


        _burnedPeanuts = _burnedPeanuts + _powerUpFee;
        return _draw(sender, ctx);
    }

    function keepWinning(
        bytes calldata ctx
    ) 
        external
    {
        (,,address sender,,) = _host.decodeCtx(ctx);
        assert(address(sender) == address(_winner));
        _acceptedToken.transferFrom(sender, address(this), _powerUpFee);

        _burnedPeanuts = _burnedPeanuts + _powerUpFee;

        _ignoreDraw++;
    }
    



    /* ------------------------------------------
                Superfluid Callbacks
    ---------------------------------------------*/
    function beforeAgreementCreated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 /*agreementId*/
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns(bytes memory cbdata)
    {
        cbdata = _meetRequirements(ctx);
    }


    function afterAgreementCreated(
        ISuperToken /*superToken*/,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns (bytes  memory newCtx)
    {
        return _play(ctx, agreementClass, agreementId, cbdata);
    }

    function beforeAgreementUpdated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 /*agreementId*/
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory cbdata)
    {
        cbdata = _meetRequirements(ctx);
    }

    function afterAgreementUpdated(
        ISuperToken /*superToken*/,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {
        return _play(ctx, agreementClass, agreementId,cbdata);
    }

    function beforeAgreementTerminated(
        ISuperToken superToken,
        bytes calldata /*ctx*/,
        address agreementClass,
        bytes32 /*agreementId*/
    )
        external view override 
        onlyHost
        returns (bytes memory data) 
    {
        //Never revert in a termination callback
        if(!_isSameToken(superToken) || !_isCFAv1(agreementClass)) return abi.encode(true);
        return abi.encode(false);
    }

    function afterAgreementTerminated(
        ISuperToken /*superToken*/,
        bytes calldata ctx,
        address /*agreementClass*/,
        bytes32 /*agreementId*/,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns(bytes memory newCtx)
    {
        //Never rever in a termination callback
        (bool shouldIgnore) = abi.decode(cbdata, (bool));
        if (shouldIgnore) return ctx;
        return _quit(ctx);
    }

    function _isSameToken(ISuperToken superToken)
        private view
        returns (bool)
    {
        return address(superToken) == address(_acceptedToken);
    }

    function _isCFAv1(address agreementClass)
        private pure
        returns (bool)
    {
        return ISuperAgreement(agreementClass).agreementType()
            ==  keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    }

    modifier onlyHost() {
        require(msg.sender == address(_host), "peanutLottery: only one host is supported");
        _;
    }

    modifier onlyExpected(ISuperToken superToken, address agreementClass) {
        require(_isSameToken(superToken), "peanutLottery: token not accepted");
        require(_isCFAv1(agreementClass), "peanutLottery: only CFAv1 is supported");
        _;
    }
 
    
}