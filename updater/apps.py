import time
import base64
import requests
import traceback
from web3 import Web3
from arango import ArangoClient
from web3.middleware import geth_poa_middleware
import config


db = ArangoClient(hosts=config.ARANGO_SERVER).db('_system')
local_to_json = {
    '_key': 'Key',
    'name': 'Name',
    'context': 'Context',
    'sponsorPublicKey': 'Sponsor Public Key',
    'sponsorEventContract': 'Contract Address',
    'wsProvider': 'Websocket Endpoint',
    'verification': 'Verification',
    'verifications': 'Verifications',
    'testing': 'Testing',
    'idsAsHex': 'Ids As Hex',
    'usingBlindSig': 'Using Blind Sig',
    'localFilter': 'Local Filter',
    'nodeUrl': 'Node Url',
    'verificationExpirationLength': 'Verification Expiration Length',
    'soulbound': 'Soulbound',
    'callbackUrl': 'Callback Url',
}


def str2bytes32(s):
    assert len(s) <= 32
    padding = (2 * (32 - len(s))) * '0'
    return (bytes(s, 'utf-8')).hex() + padding


def get_logo(url):
    try:
        res = requests.get(url)
        file_format = url.split('.')[-1]
        if file_format == 'svg':
            file_format == 'svg+xml'
        logo = 'data:image/' + file_format + ';base64,' + \
            base64.b64encode(res.content).decode('ascii')
    except Exception as e:
        print(f'Error in getting logo: {e}')
        logo = ''
    return logo


def apps_data():
    print('Updating apps', time.ctime())
    local_apps = {app['_key']: app for app in db['apps']}

    data = requests.get(config.APPS_JSON_FILE).json()

    new_local_apps = []
    for json_app in data['Applications']:
        new_local_app = {key: json_app[local_to_json[key]]
                         for key in local_to_json if local_to_json[key] in json_app}
        if 'verificationExpirationLength' in new_local_app:
            new_local_app['verificationExpirationLength'] = int(
                new_local_app['verificationExpirationLength']) if new_local_app['verificationExpirationLength'].isdigit() else 0
        if 'Links' in json_app:
            new_local_app['url'] = next(iter(json_app['Links'] or []), '')
        if 'Images' in json_app:
            new_local_app['logo'] = get_logo(
                next(iter(json_app['Images'] or []), ''))
        local_app = local_apps.get(json_app['Key'])
        if not local_app:
            print(f"New app: {new_local_app['_key']}")
            new_local_apps.append(new_local_app)
            continue

        for key in new_local_app:
            if new_local_app.get(key) != local_app.get(key):
                print(f"Updating {new_local_app['_key']} app")
                try:
                    db['apps'].update(new_local_app)
                except Exception as e:
                    print(f'Error in updating app: {e}')
                break
    try:
        print("Inserting new apps")
        db['apps'].import_bulk(new_local_apps)
    except Exception as e:
        print(f'Error in inserting new apps: {e}')

    for app_key in data['Removed apps']:
        if local_apps.get(app_key):
            try:
                print(f"Removing {app_key} app")
                db['apps'].delete(app_key)
            except Exception as e:
                print(f'Error in removing app: {e}')


def apps_balance():
    print("Updating sponsorships balance of the apps", time.ctime())
    w3_mainnet = Web3(Web3.WebsocketProvider(
        config.MAINNET_WSS, websocket_kwargs={'timeout': 60}))
    sp_contract_mainnet = w3_mainnet.eth.contract(
        address=config.MAINNET_SP_ADDRESS,
        abi=config.SP_ABI)

    w3_idchain = Web3(Web3.WebsocketProvider(
        config.IDCHAIN_WSS, websocket_kwargs={'timeout': 60}))
    w3_idchain.middleware_onion.inject(geth_poa_middleware, layer=0)
    sp_contract_idchain = w3_idchain.eth.contract(
        address=config.IDCHAIN_SP_ADDRESS,
        abi=config.SP_ABI)

    for app in db['apps']:
        app_bytes = str2bytes32(app['_key'])
        mainnet_balance = sp_contract_mainnet.functions.totalContextBalance(
            app_bytes).call()
        idchain_balance = sp_contract_idchain.functions.totalContextBalance(
            app_bytes).call()
        app['totalSponsorships'] = mainnet_balance + idchain_balance
        print(app['_key'], app['totalSponsorships'])
        db['apps'].update(app)


def update():
    apps_data()
    apps_balance()


if __name__ == '__main__':
    try:
        update()
    except Exception as e:
        print(f'Error in updater: {e}')
        traceback.print_exc()
