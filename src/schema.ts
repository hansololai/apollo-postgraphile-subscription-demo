import { createPostGraphileSchema } from 'postgraphile';
import { CRUDSubscriptionPlugin } from './plugins/CRUDSubscriptionPlugin';
import { makeSchemaAndPlugin } from 'postgraphile-apollo-server';
import { dbPool } from './configs/db'


export const makePostgraphileSchema = async () => {
  return makeSchemaAndPlugin(dbPool, 'public', {
    simpleCollections: "only",
    appendPlugins: [
      CRUDSubscriptionPlugin
    ]

  });
}

