declare module 'postgraphile-apollo-server' {
  function makeSchemaAndPlugin(pool:any, schema:any, config:any):Promise<any>;
};