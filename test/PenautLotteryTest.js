const {
    web3tx,
    toWad,
    toBN,
} = require("@decentral.ee/web3-helpers");
const { expectRevert } = require("@openzeppelin/test-helpers");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const PeanutLotteryTest = artifacts.require("PeanutLottery");
const traveler = require("ganache-time-traveler");
//const ganache = require("ganache-cli");



contract("PeanutLottery", async (accounts) => {

    const errorHandler = err => { if (err) throw err; };

    const ZERO_ADDRESS = "0x"+"0".repeat(40);
    const MINIMUM_GAME_FLOW_RATE = toWad(10).div(toBN(3600*24*30));

    accounts = accounts.slice(0, 4);
    const [admin, bob, carol, dan] = accounts;

    let sf;
    let dai;
    let daix;
    let app;

    //const nutsAddress = "0x99dD48C6FC705028cFe34BA30651e3Fe4be9713e";
    let supernut;
    let nut;



    beforeEach(async function () {
        await deployFramework(errorHandler);
        sf = new SuperfluidSDK.Framework({ web3Provider: web3.currentProvider });
        await sf.initialize();

        if (!dai) {
            await deployTestToken(errorHandler, [":", "fDAI"]);
            const daiAddress = await sf.resolver.get("tokens.fDAI");
            dai = await sf.contracts.TestToken.at(daiAddress);
            for (let i = 0; i < accounts.length; ++i) {
                await web3tx(dai.mint, `Account ${i} mints many dai`)(
                    accounts[i],
                    toWad(10000000),
                    { from: accounts[i] }
                );
            }
        }

        //daix token
        await deploySuperToken(errorHandler, [":", "fDAI"]);
        const daixWrapper = await sf.getERC20Wrapper(dai);
        daix = await sf.contracts.ISuperToken.at(daixWrapper.wrapperAddress);


        //nuts token
        if (!nut) {
            await deployTestToken(errorHandler, [":","fNUTS"]);
            const nutsAddress = await sf.resolver.get("tokens.fNUTS");
            nut = await sf.contracts.TestToken.at(nutsAddress);
            
        }

        await deploySuperToken(errorHandler, [":","fNUTS"]);
        const nutsWrapper = await sf.getERC20Wrapper(nut);
        supernut = await sf.contracts.ISuperToken.at(nutsWrapper.wrapperAddress);
        


        app = await web3tx(PeanutLotteryTest.new, "Deploy PeanutLottery")(
            sf.host.address,
            sf.agreements.cfa.address,
            sf.agreements.ida.address,
            daix.address,
            nut.address,
            supernut.address
        );

        await web3tx(nut.mint, "Admin mints many nuts to app")(
            app.address,
            toWad(946728000),
            {from: admin}
        );

        
        for (let i = 0; i < accounts.length; ++i) {
            await web3tx(dai.approve, `Account ${i} approves daix`)(daix.address, toWad(100), { from: accounts[i] });
        }

    });   

    async function timetravel(seconds) {
        timeDelta = seconds*1000; 
        console.log("traveling " + seconds + " seconds into the future ...");
        await traveler.advanceTimeAndBlock(timeDelta);
    }


    async function printRealtimeBalance(label, account) {
        const b = await daix.realtimeBalanceOfNow.call(account);
        console.log(`${label} realtime balance`,
            b.availableBalance.toString(),
            b.deposit.toString(),
            b.owedDeposit.toString());
        return b;
    }

    async function printNutsRealtimeBalance(label, account) {
        const b = await nut.balanceOf.call(account);
        console.log(`${label} realtime nut balance`,
            b.toString());
        return b;
    }

    async function printSupernutsRealtimeBalance(label, account) {
        const b = await supernut.realtimeBalanceOfNow.call(account);
        console.log(`${label} realtime supernut balance`,
            b.availableBalance.toString(),
            b.deposit.toString(),
            b.owedDeposit.toString());
        return b;
    }
    
    function createPlayBatchCall(upgradeAmount = 0) {
        return [
            [
                2, // upgrade 100 daix to play the game
                daix.address,
                web3.eth.abi.encodeParameters(
                    ["uint256"],
                    [toWad(upgradeAmount).toString()])
            ],
            [
                0, // approve the ticket fee
                daix.address,
                web3.eth.abi.encodeParameters(
                    ["address", "uint256"],
                    [app.address, toWad("1").toString()])
            ],
            [
                5, // callAppAction to participate
                app.address,
                app.contract.methods.enterPool("0x").encodeABI()
            ],
            [
                4, // create constant flow (10/mo)
                sf.agreements.cfa.address,
                sf.agreements.cfa.contract.methods.createFlow(
                    daix.address,
                    app.address,
                    MINIMUM_GAME_FLOW_RATE.toString(),
                    "0x"
                ).encodeABI()
            ]             
        ];
    }
    

    function newTriggerEvent() {
        return [
            [
                0, // approve the trigger event fee
                daix.address,
                web3.eth.abi.encodeParameters(
                    ["address", "uint256"],
                    [app.address, toWad("1").toString()])
            ],
            [
                5, // callAppAction to participate
                app.address,
                app.contract.methods.triggerEvent("0x").encodeABI()
            ] 
        ];
    }

    function keepWinner() {
        return [
            [
                0, // approve the keepWinning function fee
                daix.address,
                web3.eth.abi.encodeParameters(
                    ["address", "uint256"],
                    [app.address, toWad("1").toString()])
            ],
            [
                5, // callAppAction to participate
                app.address,
                app.contract.methods.keepWinning("0x").encodeABI()
            ]            
        ];
    }

    async function getHarvestAmount() {
        const a = (await app.harvestAmount.call()).toString();
        console.log(`peanuts to harvest: `,
            a);
        return a;
    }

    // it("Lonely game case", async () => {
    //     let appRealtimeBalance;
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);

    //     // bob is the first player
    //     await web3tx(sf.host.batchCall, "Bob joining the game")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     await expectRevert(sf.host.batchCall(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: bob }
    //     ), "Flow already exist");
    //     assert.equal((await app.currentWinner.call()).player, bob);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);

    //     // bob quits the game
    //     await web3tx(sf.host.callAgreement, "Bob quiting the game")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             bob,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);

    //     // bob is the only player again
    //     await web3tx(sf.host.batchCall, "Bob joining the game again")(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, bob);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    // })

    // it("Happy game case", async () => {
    //     let appRealtimeBalance;

    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     //
    //     // Round 1: +bob, +carol, -bob, - carol
    //     //
    //     await web3tx(sf.host.batchCall, "Bob joining the game")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, bob);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     // carol enters the game
    //     await web3tx(sf.host.batchCall, "Carol joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     let winner = (await app.currentWinner.call()).player;
    //     console.log("Winner", winner);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, winner)).toString(),
    //         MINIMUM_GAME_FLOW_RATE.toString());
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);
    //     // bob quits the game
    //     await web3tx(sf.host.callAgreement, "Bob quiting the game")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             bob,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, carol);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, carol)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);
    //     // carol quits the game
    //     await web3tx(sf.host.callAgreement, "Carol quiting the game too")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             carol,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: carol }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, carol)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);
    //     //
    //     // Round 2: +bob, +carol, -carol, -bob
    //     //
    //     // bob join the game again
    //     await web3tx(sf.host.batchCall, "Bob joining the game again")(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, bob);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, carol)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);
    //     // carol join the game again too
    //     await web3tx(sf.host.batchCall, "Carol joining the game again too")(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.callAgreement, "Carol quiting the game first this time")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             carol,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: carol }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, bob);
    //     await web3tx(sf.host.callAgreement, "Bob quiting the game too")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             bob,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: bob }
    //     );
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, app.address)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, bob)).toString(),
    //         "0");
    //     assert.equal(
    //         (await sf.agreements.cfa.getNetFlow(daix.address, carol)).toString(),
    //         "0");
    //     appRealtimeBalance = await printRealtimeBalance("App", app.address);
    //     await printRealtimeBalance("Bob", bob);
    //     await printRealtimeBalance("Carol", carol);
    //     //
    //     // Round 3: +carol, +bob, -bob, - carol
    //     //
    //     await web3tx(sf.host.batchCall, "Carol joining the game first")(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.batchCall, "Bob joining the game again")(
    //         createPlayBatchCall(0, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     await web3tx(sf.host.callAgreement, "Bob quiting the game")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             bob,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: bob }
    //     );
    //     await web3tx(sf.host.callAgreement, "Carol quiting the game")(
    //         sf.agreements.cfa.address,
    //         sf.agreements.cfa.contract.methods.deleteFlow(
    //             daix.address,
    //             carol,
    //             app.address,
    //             "0x"
    //         ).encodeABI(),
    //         { from: carol }
    //     );
    // })

    // it("Test randomness", async () => {
    //     const counters = {};
    //     counters[carol] = { name: "carol", count: 0 };
    //     counters[bob] = { name: "bob", count: 0 };
    //     counters[dan] = { name: "dan", count: 0 };
    //     await web3tx(sf.host.batchCall, "Carol joining the game")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.batchCall, "Bob joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: bob }
    //     );
    //     await web3tx(sf.host.batchCall, "Dan joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: dan }
    //     );
    //     for (let i = 0; i < 20; ++i) {
    //         counters[(await app.currentWinner.call()).player].count++;
    //         await web3tx(sf.host.callAgreement, "Dan quiting the game")(
    //             sf.agreements.cfa.address,
    //             sf.agreements.cfa.contract.methods.deleteFlow(
    //                 daix.address,
    //                 dan,
    //                 app.address,
    //                 "0x"
    //             ).encodeABI(),
    //             { from: dan }
    //         );
    //         await web3tx(sf.host.batchCall, "Dan joining the game too")(
    //             createPlayBatchCall(0, (await getHarvestAmount())),
    //             { from: dan }
    //         );
    //     }
    //     console.log("Winning counters", counters);
    //     assert.isTrue(counters[bob].count > 0);
    //     assert.isTrue(counters[carol].count > 0);
    //     assert.isTrue(counters[dan].count > 0);
    // });

    // it("Should trigger a new event", async () => {

    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     //3 players join
    //     await web3tx(sf.host.batchCall, "Carol joining the game")(
    //         createPlayBatchCall(100,(await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.batchCall, "Bob joining the game too")(
    //        createPlayBatchCall(100, (await getHarvestAmount())),
    //      { from: bob }
    //      );
    //       await web3tx(sf.host.batchCall, "Dan joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: dan }
    //     );
        
    //     for (let i=0; i<20 ;++i) {
    //         //setiting const to winner address 
    //         let thePreviousWinner = ((await app.currentWinner.call()).player);
    //         console.log("The previous winner is: " + thePreviousWinner);
    //         //winner address !== address 0
    //         assert.notEqual(((await app.currentWinner.call()).player), ZERO_ADDRESS, "The previous winner is ZERO_ADDRESS");

    //         //bob triggers event
    //         previousPeanutsBurned = await app.burnedNuts.call();
    //         await web3tx(sf.host.batchCall, "Bob triggers event")(
    //             newTriggerEvent((await getHarvestAmount())),
    //             {from: bob}
    //         );
    //         currentPeanutsBurned = await app.burnedNuts.call();


    //         //setiting const to winner address 
    //         let theCurrentWinner = ((await app.currentWinner.call()).player);
    //         console.log("The new winner is: " + theCurrentWinner);
            
    //         //nuts should have been burned
    //         console.log("Previous nuts burned: " + previousPeanutsBurned.toString());
    //         console.log("Current nuts burned: " + currentPeanutsBurned);            
    //         assert.notEqual(previousPeanutsBurned, currentPeanutsBurned);
    //     }
        
    // });

    // it("should keep current winner", async () => {
        
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     //3 players join
    //     await web3tx(sf.host.batchCall, "Carol joining the game")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.batchCall, "Bob joining the game too")(
    //        createPlayBatchCall(100, (await getHarvestAmount())),
    //      { from: bob }
    //      );
    //       await web3tx(sf.host.batchCall, "Dan joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: dan }
    //     );
    //     assert.notEqual((await app.currentWinner.call()).player, ZERO_ADDRESS);

    //     for (i=0; i <20; ++i){
    //         let thePreviousWinner = ((await app.currentWinner.call()).player);
    //         console.log("The previous winner is: " + thePreviousWinner);
    //         //winner address !== address 0
    //         assert.notEqual(((await app.currentWinner.call()).player), ZERO_ADDRESS, "The previous winner is ZERO_ADDRESS");
            
    //         console.log("There are " + (await app.ignoreTokens.call()) + " ignoreDraw tokens");
    //         //winner calls for new event
    //         previousPeanutsBurned = await app.burnedNuts.call();
    //         assert.equal(thePreviousWinner, (await app.currentWinner.call()).player);
    //         await web3tx(sf.host.batchCall, "Winner triggers event")(
    //             keepWinner(),
    //             {from: thePreviousWinner}
    //         );
    //         console.log("There are " + (await app.ignoreTokens.call()) + " ignoreDraw tokens");

    //         currentPeanutsBurned = await app.burnedNuts.call();
    //         assert.equal(thePreviousWinner, (await app.currentWinner.call()).player);
            
            
            
    //         //nuts should have been burned
    //         console.log("Previous nuts burned: " + previousPeanutsBurned);
    //         console.log("Current nuts burned: " + currentPeanutsBurned);            
    //         assert.notEqual(previousPeanutsBurned, currentPeanutsBurned);

            
    //         //bob triggers event
    //         previousPeanutsBurnedv2 = await app.burnedNuts.call();
    //         await web3tx(sf.host.batchCall, "Bob triggers event")(
    //             newTriggerEvent((await getHarvestAmount())),
    //             {from: bob}
    //         );
    //         //setiting const to winner address 
    //         let theCurrentWinner = ((await app.currentWinner.call()).player);
    //         console.log("The new winner is: " + theCurrentWinner);
    //         currentPeanutsBurnedv2 = await app.burnedNuts.call();
    //         //nuts should have been burned
    //         console.log("After triggerEvent: Previous nuts burned: " + previousPeanutsBurnedv2);
    //         console.log("After triggerEvent: Current nuts burned: " + currentPeanutsBurned); 
    //         assert.notEqual(previousPeanutsBurnedv2, currentPeanutsBurnedv2);
            

    //         //winner should remain the same
    //         assert.equal(theCurrentWinner, thePreviousWinner);         
    //     }
    // });

    // it("should be able to buy multiple ignoreDraw tokens", async () => {
        
    //     assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);
    //     //3 players join
    //     await web3tx(sf.host.batchCall, "Carol joining the game")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: carol }
    //     );
    //     await web3tx(sf.host.batchCall, "Bob joining the game too")(
    //        createPlayBatchCall(100, (await getHarvestAmount())),
    //      { from: bob }
    //      );
    //       await web3tx(sf.host.batchCall, "Dan joining the game too")(
    //         createPlayBatchCall(100, (await getHarvestAmount())),
    //         { from: dan }
    //     );
    //     assert.notEqual((await app.currentWinner.call()).player, ZERO_ADDRESS);

    //     for (i=0; i <20; ++i){
    //         //winner address !== address 0
    //         assert.notEqual(((await app.currentWinner.call()).player), ZERO_ADDRESS, "The previous winner is ZERO_ADDRESS");
            
    //         let thePreviousWinner = (await app.currentWinner.call()).player;

    //         console.log("There are " + (await app.ignoreTokens.call()) + " ignoreDraw tokens");
    //         //winner calls for new event
    //         previousPeanutsBurned = await app.burnedNuts.call();
    //         assert.equal(thePreviousWinner, (await app.currentWinner.call()).player);
    //         await web3tx(sf.host.batchCall, "Winner triggers event")(
    //             keepWinner(),
    //             {from: thePreviousWinner}
    //         );
    //         console.log("There are " + (await app.ignoreTokens.call()) + " ignoreDraw tokens");
            

    //         currentPeanutsBurned = await app.burnedNuts.call();
    //         assert.equal(thePreviousWinner, (await app.currentWinner.call()).player);
            
    //         //nuts should have been burned
    //         console.log("Previous nuts burned: " + previousPeanutsBurned);
    //         console.log("Current nuts burned: " + currentPeanutsBurned);            
    //         assert.notEqual(previousPeanutsBurned, currentPeanutsBurned);         
    //     }
        
    //     const ignoreTokensAvailable = await app.ignoreTokens.call();
    //     console.log("There are " + ignoreTokensAvailable + " ignoreDraw tokens available");
    //     for (i=0; i < ignoreTokensAvailable; i++){

    //         let thePreviousWinnerv2 = (await app.currentWinner.call()).player;
    //         //bob triggers event
    //         previousPeanutsBurnedv2 = await app.burnedNuts.call();
    //         await web3tx(sf.host.batchCall, "Bob triggers event")(
    //             newTriggerEvent((await getHarvestAmount())),
    //             {from: bob}
    //         );
    //         //setiting const to winner address 
    //         let theCurrentWinnerv2 = ((await app.currentWinner.call()).player);
    //         console.log("The new winner is: " + theCurrentWinnerv2);
    //         currentPeanutsBurnedv2 = await app.burnedNuts.call();
    //         //nuts should have been burned
    //         console.log("After triggerEvent: Previous nuts burned: " + previousPeanutsBurnedv2);
    //         console.log("After triggerEvent: Current nuts burned: " + currentPeanutsBurned); 
    //         assert.notEqual(previousPeanutsBurnedv2, currentPeanutsBurnedv2);

    //         //winner should remain the same
    //         assert.equal(theCurrentWinnerv2, thePreviousWinnerv2);  
    //         console.log("There are " + (await app.ignoreTokens.call()) + " ignoreDraw tokens");
    //     }
    //     //no ignore tokens should be available
    //     assert.equal( (await app.ignoreTokens.call()), "0" );

    // });

    // it("should create 30 seconds of peanuts", async () =>{

    //     const initTime = await app.getTimestamp.call();
    //     console.log("current block number: " + (await web3.eth.getBlockNumber()));

    //     //time travel
    //     timeDelta = 30000;
    //     console.log("traveling " + timeDelta + " seconds into the future ...");
    //     await traveler.advanceTimeAndBlock(timeDelta);

    //     const finTime = await app.getTimestamp.call();
    //     console.log("current block number: " + (await web3.eth.getBlockNumber()));
    //     assert.equal((finTime - initTime), timeDelta)


    //     console.log("Peanuts to harvest = " + (await app.harvestAmount.call()));
    //     assert.equal(timeDelta, await app.harvestAmount.call());

    // })

    it("should create and allocate peanuts to players ", async () => {
        let appRealtimeBalance;
        let appRealtimeNutBalance;
        appRealtimeBalance = printRealtimeBalance("App", app.address);
        appRealtimeNutBalance = printNutsRealtimeBalance("App", app.address);
        console.log("peanuts ready to harvest " + (await app.harvestAmount.call()));
        assert.equal((await app.currentWinner.call()).player, ZERO_ADDRESS);

        //3 players join
        await web3tx(sf.host.batchCall, "Carol joining the game")(
            createPlayBatchCall(100),
            { from: carol }
        );
        appRealtimeBalance = printRealtimeBalance("App", app.address);
        appRealtimeNutBalance = printNutsRealtimeBalance("Host", sf.host.address);
        console.log("peanuts ready to harvest " + (await app.harvestAmount.call()));

        await web3tx(sf.host.batchCall, "Bob joining the game too")(
            createPlayBatchCall(100),
            { from: bob }
        );
        appRealtimeBalance = printRealtimeBalance("App", app.address);
        appRealtimeNutBalance = printNutsRealtimeBalance("Host", sf.host.address);
        console.log("peanuts ready to harvest " + (await app.harvestAmount.call()));

        await web3tx(sf.host.batchCall, "Dan joining the game too")(
            createPlayBatchCall(100),
            { from: dan }
        );
        appRealtimeBalance = printRealtimeBalance("App", app.address);
        appRealtimeNutBalance = printNutsRealtimeBalance("Host", sf.host.address);
        console.log("peanuts ready to harvest " + (await app.harvestAmount.call()));
        
        //bob wait 60 seconds and then triggers an event
        for (i=0; i<20; i++){
            //timetravel
            timetravel(60);
            await web3tx(sf.host.batchCall, "Bob triggers event")(
                newTriggerEvent(),
                {from: bob}
            );
            appRealtimeBalance = printRealtimeBalance("App", app.address);
            appRealtimeNutBalance = printNutsRealtimeBalance("Host", sf.host.address);
            console.log("peanuts ready to harvest " + (await app.harvestAmount.call()));
        }
        
        
        appRealtimeBalance = printRealtimeBalance("App", app.address);
        appRealtimeNutBalance = printNutsRealtimeBalance("Host", sf.host.address);
    })

    // it("should have the same address as supernut", async () => {
    //     console.log((await app.getPeanutAddress.call()));
    //     console.log((await supernut.address));
    //     console.log((await nut.address));
    // })




});

