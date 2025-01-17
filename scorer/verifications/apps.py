import time
from arango import ArangoClient
from py_expression_eval import Parser
import config


def verify(block):
    print('Update verifications for apps')
    db = ArangoClient(hosts=config.ARANGO_SERVER).db('_system')
    parser = Parser()
    expressions = {}
    for app in db['apps']:
        if not app.get('verification'):
            continue
        try:
            expr = parser.parse(app['verification'])
            variables = expr.variables()
            expressions[app['verification']] = (expr,  variables)
        except:
            print('{} has an invalid verification expression: {}'.format(app['name'], app['verification']))
            continue

    batch_db = db.begin_batch_execution(return_result=True)
    batch_col = batch_db.collection('verifications')
    counter = 0
    for user in db['users']:
        verifications = {}
        for v in db['verifications'].find({'block': block, 'user': user['_key']}):
            verifications[v['name']] = True
            for k in v:
                if k in ['_key', '_id', '_rev', 'user', 'name']:
                    continue
                verifications[f'{v["name"]}.{k}'] = v[k]

        for (key, (expr, variables)) in expressions.items():
            try:
                verifications.update(
                    {k: False for k in variables if k not in verifications})
                verified = expr.evaluate(verifications)
            except:
                print('invalid verification expression')
                continue

            if verified:
                batch_col.insert({
                    'expression': True,
                    'name': key,
                    'user': user['_key'],
                    'block': block,
                    'timestamp': int(time.time() * 1000)
                })
                counter += 1
                if counter % 1000 == 0:
                    batch_db.commit()
                    batch_db = db.begin_batch_execution(return_result=True)
                    batch_col = batch_db.collection('verifications')
    batch_db.commit()
