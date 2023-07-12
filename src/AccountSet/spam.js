const xrpl = require("xrpl");
const fs = require("fs");

/**
 * Perform a B2M transaction once via an AccountSet transaction (SPAM B2M TRANSACTIONS FOR TESTING PURPOSES).
 * 
 * --- Resources ---
 * - HOOKSv3 BINARY (POB NODE): https://yidczxh.dlvr.cloud/pob
 * - TESTNET FAUCET: https://xrpl.org/xrp-testnet-faucet.html
 * TESTNET EXPLORER: https://testnet.xrpl.org/
 * HOOKSv3 EXPLORER: https://hooks-testnet-v3-explorer.xrpl-labs.com/
 * 
 * TESTNET NETWORK ID: 1
 * HOOKSV3 NETWORK ID: 21338
 * 
 * --- B2M NOTE !!! ---
 * 
 * 1. B2M is meant for *technical* and *enterprise* users, specifically liquidity providers.
 * 2. No 3rd party is involved in B2M, B2M is a self-sovereign protocol/procedure; It is your own doing and no other party is liable. 
 * 3. B2M is PERMANENT, XRP burnt cannot be returned to you, it goes POOF!
 * 4. You'd have to run a node on the source XRPL chain (testnet ID: 1) to listen to the overlay network for validation messages,
 *    to construct an XPOP blob, which would be used as a way to prove that you've actually burnt XRP on the source XRPL chain.
 */

async function delay(ms) {
    await new Promise(res => setTimeout(res, ms))
}

async function main() {
    // AMOUNT OF B2M TX
    const spam = 100;

    const testnet_client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
    await testnet_client.connect();
    console.log("Connected to Ripple's testnet...")

    // Initialize wallet
    const wallet = xrpl.Wallet.fromSeed("XXX");

    console.log("Address: ", wallet.classicAddress)

    const response = await testnet_client.request({
        "command": "account_info",
        "account": wallet.classicAddress,
        "ledger_index": "validated"
    })

    var burn_txs = [],
        submit_burn_txs = []

    var xpop_blobs = []

    for (let seq = response.result.account_data.Sequence; seq < response.result.account_data.Sequence+spam; seq++) {
        // Autofill AccountSet tx (Burn Transaction)
        const burn_tx = await testnet_client.autofill({
            "TransactionType": "AccountSet",
            "Account": wallet.classicAddress,
            "Sequence": seq,
            "Fee": xrpl.xrpToDrops("1"), // 1000 XRP
            "OperationLimit": 21338
        })

        const signed_burn_tx = wallet.sign(burn_tx);
        
        burn_txs.push(signed_burn_tx)
    }

    // Sign, submit and wait for tx validation
    async function send_burn_batch() {
        for (const signed_burn_tx of burn_txs) {
            const submit_burn_tx = await testnet_client.submit(signed_burn_tx.tx_blob);
            submit_burn_txs.push(submit_burn_tx)
        }
    }

    await send_burn_batch();

    submit_burn_txs.forEach(submit_burn_tx => {
        console.log(`LOG - Burn Tx result: ${submit_burn_tx.result.engine_result}`);
    })

    await testnet_client.disconnect();
    console.log("Disconnected from Ripple's testnet...\n")

    // Connect to HooksV3 node
    const hooks_client = new xrpl.Client('wss://hooks-testnet-v3.xrpl-labs.com');
    await hooks_client.connect()
    console.log("\nConnected to the HooksV3 testnet...")

    try {
        var acc_info_0 = await hooks_client.request({
            command: "account_info",
            account: wallet.classicAddress
        });
        var seq = acc_info_0.result.account_data.Sequence;
    } catch (err) {
        console.log(`\nWRN - Account ${wallet.classicAddress} is not funded on HooksV3, funding...`);
        var seq = 0;
    }

    // For precaution reasons. Wait 10 seconds for the POB node to generate our XPOP file(s)
    await delay(10000);

    burn_txs.forEach(burn_tx => {
        // Read the XPOP blob and encode into HEX
        console.log(`Burn Tx hash: ${burn_tx.hash}`)
        const xpop_blob = fs.readFileSync(`/home/wojake/xpop/${burn_tx.hash}`).toString('hex');
        xpop_blobs.push(xpop_blob)
    })

    // Autofill Import tx (Mint Transaction)
    async function send_mint_batch() {
        var signed_mint_txs = []

        for (const xpop_blob of xpop_blobs) {
            const autofilled_mint_tx = await hooks_client.autofill({
                "TransactionType": "Import",
                "Account": wallet.classicAddress,
                "Blob": xpop_blob,
                "Sequence": seq,
                "NetworkID": 21338,
                "Fee": "0"
            })

            // Update the seq field for the next tx
            seq += 1
            // Sign, submit and wait for tx validation
            const signed_mint_tx = wallet.sign(autofilled_mint_tx)
            signed_mint_txs.push(signed_mint_tx)
        }

        for (const signed_mint_tx of signed_mint_txs) {
            const submit_mint_tx = await hooks_client.submit(signed_mint_tx.tx_blob);
            console.log(`LOG - Mint Tx result : ${submit_mint_tx.result.engine_result}`)
        }
    }

    await send_mint_batch()

    const acc_info_1 = await hooks_client.request({
        command: "account_info",
        account: wallet.classicAddress
    });

    console.log(`\nLOG - HooksV3 Account Balance: ${acc_info_1.result.account_data.Balance / 1000000} XRP\n`)

    await hooks_client.disconnect()
}

main()