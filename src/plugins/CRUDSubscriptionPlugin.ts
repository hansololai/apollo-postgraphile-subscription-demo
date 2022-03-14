import { GraphQLFieldConfigMap } from "graphql/type";
import { Build, Context, makeAddInflectorsPlugin, makePluginByCombiningPlugins, makeWrapResolversPlugin, Plugin, SchemaBuilder } from "postgraphile";
import { GraphileBuild } from "../@types/postgraphile";
import { PubSub, withFilter } from 'graphql-subscriptions'
import { PgClass } from "graphile-build-pg";
import { transformSelectionSet } from "../subscriptionLoader";

// temporary
const pubsub = new PubSub();

// Some utility
const getPrimaryKeyAttribute = (table: PgClass) => {
  return table.primaryKeyConstraint?.keyAttributes[0];
}

const subscribableMutationRule = (context: Context<any>) => {
  const {
    scope: { isRootMutation, pgFieldIntrospection: table },
  } = context;
  if (!isRootMutation) {
    return false;
  }
  const primaryAttributes = (table as PgClass).primaryKeyConstraint?.keyAttributes;
  if (!primaryAttributes || primaryAttributes?.length != 1) {
    return false;
  }
  return true;
}

const INTERNAL_RECORD_ID_FIELD = "__ModifiedRecordId";


// Plugins
const CRUDSubscriptionRootFieldInflectorPlugin = makeAddInflectorsPlugin({
  subscribeUpdateFieldName(typeName: string) {
    // @ts-ignore
    // "this" here is an Inflector | InflectorGenerator type, which were defined
    // in graphile-utils and these two types are not exported
    // So it cannot even be casted here
    return this.camelCase(`${typeName}-updated`);
  },
  subscribeUpdateAllFieldName(typeName: string) {
    // @ts-ignore
    return this.camelCase(`${typeName}-updatedAll`);
  },
  subscribeDeleteFieldName(typeName: string) {
    // @ts-ignore
    return this.camelCase(`${typeName}-deleted`);
  },
  subscribeCreateFieldName(typeName: string) {
    // @ts-ignore
    return this.camelCase(`${typeName}-added`);
  },
})


const AddIdToMutationResultPlugin: Plugin = (builder) => {
  builder.hook("GraphQLObjectType:fields:field", (field, build, context) => {
    const { pgSql: sql } = build;
    const { scope: { isRootMutation, pgFieldIntrospection: table }, addArgDataGenerator } = context;

    if (!isRootMutation) {
      return field;
    }

    // get the primary key field of table, only support table with only 1 primary key field.
    const primaryAttributes = (table as PgClass).primaryKeyConstraint?.keyAttributes;
    if (!primaryAttributes || primaryAttributes?.length != 1) {
      return field;
    }

    const primaryAttributeName = primaryAttributes[0].name;

    addArgDataGenerator(() => ({
      pgQuery: (queryBuilder: any) => {
        console.log("add id to select query")
        queryBuilder.select(
          // Select this value from the result of the INSERT:
          sql.query`${queryBuilder.getTableAlias()}.${sql.identifier(primaryAttributeName)}`,
          // And give it this name in the result data:
          INTERNAL_RECORD_ID_FIELD
        );
      },
    }));
    return field;
  })

}

const AddBroadcastToCRUDMutationsPlugin = makeWrapResolversPlugin((context, build) => {
  if (subscribableMutationRule(context)) {
    return { context, build };
  }
  return null;
}, ({ context, build }) => {
  const {
    inflection,
  } = build;
  const {
    scope: {
      pgFieldIntrospection,
      isPgCreateMutationField,
      isPgDeleteMutationField,
      isPgUpdateMutationField,
    },
  } = context;

  const table: PgClass = pgFieldIntrospection;
  const primaryAttribute = getPrimaryKeyAttribute(table);
  const tableNodeName = inflection.tableNode(table);
  const channelNames: string[] = [];
  if (isPgDeleteMutationField) {
    channelNames.push(inflection.subscribeDeleteFieldName(tableNodeName));
  } else if (isPgCreateMutationField) {
    channelNames.push(inflection.subscribeCreateFieldName(tableNodeName));
  } else if (isPgUpdateMutationField) {
    channelNames.push(inflection.subscribeUpdateFieldName(tableNodeName));
    channelNames.push(inflection.subscribeUpdateAllFieldName(tableNodeName));
  }
  return async (resolver, _, args, resolverContext: any, resolveInfo) => {
    const response = await resolver(_, args, resolverContext, resolveInfo);
    console.log("after mutation");
    const id = response.data[INTERNAL_RECORD_ID_FIELD];
    console.log("response is ", response)
    console.log("response data is ", response.data)
    console.log("after mutation id is ",id);
    // broadcast
    channelNames.forEach(channel => {
      console.log("broadcasting id is ",id);
      pubsub.publish(channel, {
        [channel]: { [primaryAttribute?.name || 'id']: id }
      })
    })
    return response;
  }


});



/**
 * @description This plugin create subscription fields for every pg-table. For each table name,
 * if model name is X, it will create XUpdated(id:int), XCreated, and XDeleted fields.
 */
const AddCRUDSubscriptionRootFieldPlugin = (builder: SchemaBuilder) => {
  builder.hook('GraphQLObjectType:fields', (fields, build, rootContext) => {
    const {
      extend,
      pgIntrospectionResultsByKind,
      pgGetGqlTypeByTypeIdAndModifier,
      inflection,
      graphql: { GraphQLInt },
    } = build as GraphileBuild;
    const {
      scope: {
        isRootSubscription,
      },
      fieldWithHooks,
    } = rootContext;

    if (!isRootSubscription) {
      return fields;
    }


    return extend(
      fields,
      pgIntrospectionResultsByKind.class.reduce(
        (memo: GraphQLFieldConfigMap<any, any>, table) => {
          // skip different schema
          if (!table.namespace) return memo;
          const tableNodeName = inflection.tableNode(table);
          const rootFieldName = `${tableNodeName}ById`;
          const tableName = inflection.tableFieldName(table);
          const tableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);

          const subscribeUpdateFieldName = inflection.subscribeUpdateFieldName(tableName);
          const subscribCreateFieldName = inflection.subscribeCreateFieldName(tableName);
          const subscribDeleteFieldName = inflection.subscribeDeleteFieldName(tableName);
          const subscribUpdateAllFieldName = inflection.subscribeUpdateAllFieldName(tableName);


          const primaryAttribute = getPrimaryKeyAttribute(table);

          const generateTransformFunction = (fieldName: string) => async (payload: any,
            args: any, context: any, info: any) => {
            const id = payload[fieldName]?.id;
            const response = await transformSelectionSet(
              id, context, rootFieldName, info, info.schema
            );
            return response || payload[fieldName];
          };
          const primaryAttributeName = primaryAttribute?.name || 'id';
          return build.extend(memo, {
            [subscribeUpdateFieldName]: fieldWithHooks(
              subscribeUpdateFieldName,
              () => ({
                type: tableType,
                args: {
                  [primaryAttributeName]: {
                    type: GraphQLInt,
                  },
                },
                subscribe: async (_: any, args: any, context: any, info: any) => {
                  const iterator: AsyncIterator<{}> = withFilter(
                    () => pubsub.asyncIterator(subscribeUpdateFieldName),
                    (payload) => {
                      const {
                        [subscribeUpdateFieldName]: { [primaryAttribute?.name || 'id']: id },
                      } = payload;
                      console.log("Updated subscription: payload is ", payload);
                      return Number(id) === args[primaryAttributeName];
                    },
                  )(_, args, context, info);
                  return iterator;
                },
                resolve: generateTransformFunction(subscribeUpdateFieldName),
              }),
              {
                isPgSubscription: true,
              },
            ),
            [subscribUpdateAllFieldName]: fieldWithHooks(
              subscribUpdateAllFieldName,
              () => ({
                type: tableType,
                subscribe: async () => {
                  const iterator: AsyncIterator<{}> = pubsub.asyncIterator(
                    subscribUpdateAllFieldName,
                  );
                  return iterator;
                },
                resolve: generateTransformFunction(subscribUpdateAllFieldName),
              }),
              {
                isPgSubscription: true,
              },
            ),
            [subscribCreateFieldName]: fieldWithHooks(
              subscribCreateFieldName,
              () => ({
                type: tableType,
                subscribe: async () => {
                  const iterator: AsyncIterator<{}> = pubsub.asyncIterator(
                    subscribCreateFieldName,
                  );
                  return iterator;
                },
                resolve: generateTransformFunction(subscribCreateFieldName),
              }),
              {
                isPgSubscription: true,
              },
            ),
            [subscribDeleteFieldName]: fieldWithHooks(
              subscribDeleteFieldName,
              () => ({
                type: tableType,
                subscribe: async () => {
                  const iterator: AsyncIterator<{}> = pubsub.asyncIterator(
                    subscribDeleteFieldName,
                  );
                  return iterator;
                },
                resolve: generateTransformFunction(subscribDeleteFieldName),
              }),
              {
                isPgSubscription: true,
              },
            ),
          });
        },
        {} as GraphQLFieldConfigMap<any, any>,
      ),
    );
  });
};

export const CRUDSubscriptionPlugin = makePluginByCombiningPlugins(
  CRUDSubscriptionRootFieldInflectorPlugin, AddCRUDSubscriptionRootFieldPlugin,
  AddIdToMutationResultPlugin, AddBroadcastToCRUDMutationsPlugin);