import express from "express";
import { envelop, useSchema } from "@envelop/core";
import { ApolloServer } from "apollo-server-express";
import http from "http"
import { makePostgraphileSchema } from './schema'
import dotenv from 'dotenv'
dotenv.config();
import { WebSocketServer } from 'ws'
import { useServer } from "graphql-ws/lib/use/ws";
import { dbPool } from './configs/db'
import { GraphQLSchema } from "graphql";
import { ApolloServerPlugin } from "apollo-server-plugin-base";



const addPgClientToContext = async (ctx: CustomContext= {}) => {
  return {
    ...ctx,
    pgClient: await dbPool.connect()
  };
}
const createApolloServer = async (schema: GraphQLSchema, plugin: ApolloServerPlugin) => {

  const getEnveloped = envelop({
    plugins: [useSchema(schema),
      {
        onExecute({args}){
          console.log("env on execute");
          return {
            onExecuteDone({result, setResult}){
              console.log(result)
            }
          }
        }
      }
    ]
  });
  const logLifecyclePlugin: ApolloServerPlugin = {
    async serverWillStart() {
      console.log("server will start");
    },
    async requestDidStart() {
      console.log("request did start");
      return {
        async parsingDidStart() {
          console.log("parsing did start")
        },
        async validationDidStart() {
          console.log("validation did start")
        },
        async didResolveSource() {
          console.log("did resolve source");
        },
        async didResolveOperation(requestContext) {
          console.log("did resolve operation");
          const { schema: newSchema, contextFactory } = getEnveloped({
            req: requestContext.request.http
          });

          const envelopContext = await contextFactory(requestContext.request);
          // @ts-ignore
          requestContext.schema = newSchema;
          Object.assign(requestContext.context, envelopContext);
        },
        async responseForOperation() {
          console.log("response for operation");
          return null;
        },
        async executionDidStart() {
          console.log("execution did start");
          return {
            async executionDidEnd() {
              console.log("execution did end");
            },
            willResolveField(param) {
              const { info } = param;
              console.log(`resolved ${info.fieldName}`);
              return (error, result) => {
                console.log(`resolved ${result}`);
              }
            }
          }
        },
        async willSendResponse() {
          console.log("will send response");
        }

      };
    }

  }

  return new ApolloServer({
    schema,
    // executor: async (requestContext) => {
    //   const { schema: newSchema, execute, contextFactory } = getEnveloped({
    //     req: requestContext.request.http
    //   });
    //   const envelopContext = await contextFactory(requestContext.request);

    //   return execute({
    //     schema: newSchema,
    //     document: requestContext.document,
    //     contextValue: { ...requestContext.context, ...envelopContext },
    //     variableValues: requestContext.request.variables,
    //     operationName: requestContext.operationName
    //   });
    // },
    plugins: [
      plugin,
      logLifecyclePlugin
    ]
  });
}



async function startApolloServer() {
  const app = express();
  const { schema, plugin } = await makePostgraphileSchema();
  const httpServer = http.createServer(app);
  const wsServer = new WebSocketServer({ server: httpServer, path: "/graphql" });
  useServer({
    schema, context: async () => {
      return addPgClientToContext({});
    }
  }, wsServer);
  const server = await createApolloServer(schema, plugin);
  await server.start();
  server.applyMiddleware({ app, path: "/graphql" });
  await new Promise((resolve) => httpServer.listen({ port: 4000 }, () => { return resolve(undefined); }));
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
}

startApolloServer();
