import os
import socket
import time
import json
import binascii
import copy
import base64
import hashlib
import shutil
import requests
from arango import ArangoClient, errno
import config


db = ArangoClient(hosts=config.ARANGO_SERVER).db('_system')

def hash(op):
    op = {k: op[k] for k in op if k not in (
        'sig', 'sig1', 'sig2', 'hash', 'blockTime')}
    if op['name'] == 'Set Signing Key':
        del op['id1']
        del op['id2']
    if op['name'] == 'Social Recovery' and op['v'] == 6:
        del op['id1']
        del op['id2']
    message = json.dumps(op, sort_keys=True, separators=(',', ':'))
    m = hashlib.sha256()
    m.update(message.encode('ascii'))
    h = base64.b64encode(m.digest()).decode('ascii')
    return h.replace('+', '-').replace('/', '_').replace('=', '')


def process_op(op):
    print(op)
    url = config.APPLY_URL.format(v=op['v'], hash=hash(op))
    r = requests.put(url, json=op)
    resp = r.json()
    print(resp)
    # resp is returned from PUT /operations handler
    if resp.get('state') == 'failed':
        if resp['result'].get('arangoErrorNum') == errno.CONFLICT:
            print('retry on conflict')
            return process_op(op)
    # resp is returned from arango not PUT /operations handler
    # joi errors (bad request errors) have code 400
    if resp.get('error') and resp.get('code') != 400:
        raise Exception('Error from apply service')


def main():
    for op in db.collection('operations').find({'state': 'init'}):
        ignore = ['_id', '_rev', 'state', '_key', 'hash']
        d = {k: op[k] for k in op if k not in ignore}
        d['blockTime'] = op['timestamp']
        process_op(d)



def wait():
    while True:
        time.sleep(5)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex((config.BN_ARANGO_HOST, config.BN_ARANGO_PORT))
        sock.close()
        if result != 0:
            print('db is not running yet')
            continue
        # wait for ws to start upgrading foxx services and running setup script
        time.sleep(10)
        services = [service['name'] for service in db.foxx.services()]
        if 'apply' not in services or 'BrightID-Node' not in services:
            print('foxx services are not running yet')
            continue
        collections = [c['name'] for c in db.collections()]
        if 'operations' not in collections:
            print('operations collection is not created yet')
            continue
        #collections = [c['name'] for c in db.collections()]
        #if 'apps' not in collections:
        #    print('apps collection is not created yet')
        #    continue
        #apps = [app for app in db.collection('apps')]
        #if len(apps) == 0:
        #    print('apps collection is not loaded yet')
        #    continue
        return

if __name__ == '__main__':
    print('waiting for db ...')
    wait()
    print('started ...')
    while True:
        try:
            main()
            time.sleep(1)
        except Exception as e:
            print(f'Error: {e}')
            time.sleep(10)
            print('started ...')

##############################################################################################



def save_snapshot(block):
    dir_name = config.SNAPSHOTS_PATH.format(block)
    fnl_dir_name = f'{dir_name}_fnl'
    dir_path = os.path.dirname(os.path.realpath(__file__))
    collections_file = os.path.join(dir_path, 'collections.json')
    res = os.system(f'arangodump --overwrite true --compress-output false --server.password "" --server.endpoint "tcp://{config.BN_ARANGO_HOST}:{config.BN_ARANGO_PORT}" --output-directory {dir_name} --maskings {collections_file}')
    assert res == 0, "dumping snapshot failed"
    shutil.move(dir_name, fnl_dir_name)


