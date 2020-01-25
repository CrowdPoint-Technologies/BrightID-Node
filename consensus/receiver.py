import os
import time
import json
import binascii
import base64
import hashlib
import zipfile
import requests 
from arango import ArangoClient
from arango.exceptions import DocumentGetError
from web3 import Web3, HTTPProvider
import config

w3 = Web3(HTTPProvider(config.INFURA_URL))
db = ArangoClient().db('_system')

def process(data):
    try:
        data = bytes.fromhex(data.strip('0x')).decode('utf-8')
        op = json.loads(data)
    except ValueError as e:
        return False
    r = requests.put(config.APPLY_URL, json=op)
    print(op)
    print(r.json())
    assert r.json().get('success') == True

def save_snapshot(block):
    batch = db.replication.create_dump_batch(ttl=1000)
    zf = zipfile.ZipFile(config.SNAPSHOTS_PATH.format(block), mode='w')
    for collection in ('users', 'groups', 'usersInGroups', 'connections'):
        params = {'batchId': batch['id'], 'collection': collection, 'chunkSize': config.MAX_COLLECTION_SIZE}
        r = requests.get(config.DUMP_URL, params=params)
        zf.writestr('dump/{}_{}.data.json'.format(collection, batch['id']), r.text)
    zf.close()
    db.replication.delete_dump_batch(batch['id'])

def main():
    variables = db.collection('variables')
    try:
        last_block = variables.get('LAST_BLOCK')
    except DocumentGetError:
        last_block = variables.insert({
            '_key': 'LAST_BLOCK',
            'value': w3.eth.getBlock('latest').number
        })


    while True:
        current_block = w3.eth.getBlock('latest').number
        for block in range(last_block['value']+1, current_block-config.CONFIRM_NUM+1):
            print('processing block {}'.format(block))
            for i, tx in enumerate(w3.eth.getBlock(block, True)['transactions']):
                if tx['to'] and tx['to'].lower() == config.TO_ADDRESS.lower():
                    process(tx['input'])
            if block % config.SNAPSHOTS_PERIOD == 0:
                save_snapshot(block)
            last_block['value'] = block
            last_block = variables.update(last_block)
        time.sleep(5)

if __name__ == '__main__':
    print('receiver started ...')
    main()