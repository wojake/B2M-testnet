const xrpl = require("xrpl");
const fs = require("fs");

/**
 * Perform a B2M transaction once via an SignerListSet transaction (CREATES SIGNER LIST ON MAINNET AND HOOKS SIDECHAIN).
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
    const testnet_client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
    await testnet_client.connect();
    console.log("Connected to Ripple's testnet...")

    var wallets = []
    for (let number = 0; number < 32; number++) {
        wallets.push(xrpl.Wallet.generate());
    }

    // Initialize wallet
    const wallet = xrpl.Wallet.fromSeed("XXX");
    
    var signer_list = []
    wallets.forEach(wallet => {
        signer_list.push({
            "SignerEntry": {
                "Account": wallet.classicAddress,
                "SignerWeight": 1
            }
        })
    })

    // Autofill AccountSet tx (Burn Transaction)
    const burn_tx = await testnet_client.autofill({
        "TransactionType": "SignerListSet",
        "Account": wallet.classicAddress,
		"SignerEntries": signer_list,
		"SignerQuorum": Math.round(signer_list.length * 0.80),
        "Fee": xrpl.xrpToDrops("1000"), // 1000 XRP
        "OperationLimit": 21338
    })

    // Sign, submit and wait for tx validation
    const signed_burn_tx = wallet.sign(burn_tx);
    const submit_burn_tx = await testnet_client.submitAndWait(signed_burn_tx.tx_blob);
    await testnet_client.disconnect();
    console.log("Disconnected from Ripple's testnet...")

    console.log(`\nLOG - Burn Tx result: ${submit_burn_tx.result.meta.TransactionResult}`);

    console.log(`\nLOG - Burn Tx hash: ${submit_burn_tx.result.hash}`);
    
    // Wait 10 seconds (just to be safe) for the POB node to generate our XPOP file
    await delay(10000); 
    // Read the XPOP blob and encode into HEX
    const xpop_blob = fs.readFileSync(`/home/wojake/xpop/${submit_burn_tx.result.hash}-devmachine2`).toString('hex');
        
    console.log(`\nLOG - XPOP BLOB (HEX): ${xpop_blob.substring(0,50)}... ${xpop_blob.length-50} chars left`)
    // Connect to HooksV3 node
    const hooks_client = new xrpl.Client('wss://hooks-testnet-v3.xrpl-labs.com');
    await hooks_client.connect()
    console.log("Connected to the HooksV3 testnet...")

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

    // Autofill Import tx (Mint Transaction)
    const autofilled_mint_tx = await hooks_client.autofill({
        "TransactionType": "Import",
        "Account": wallet.classicAddress,
        "Blob": xpop_blob,
        "Sequence": seq,
        "NetworkID": 21338,
        "Fee": "0"
    })

    // Sign, submit and wait for tx validation
    const signed_mint_tx = wallet.sign(autofilled_mint_tx)
    const submit_mint_tx = await hooks_client.submitAndWait(signed_mint_tx.tx_blob);

    console.log(`\nLOG - Mint Tx result: ${submit_mint_tx.result.meta.TransactionResult}`)
        
    const acc_info_1 = await hooks_client.request({
        command: "account_info",
        account: wallet.classicAddress
    });

    console.log(`\nLOG - HooksV3 Account Balance: ${acc_info_1.result.account_data.Balance / 1000000} XRP\n`)

    await hooks_client.disconnect()
}

main()