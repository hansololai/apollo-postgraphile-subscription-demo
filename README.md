# Apollo-PostGraphile-Subscription-Demo

Using PostGraphile with Apollo enables a lot of freedom than just run a PostGraphile server. (For example, apollo plugins, apollo studio, middlewares, apollo playground etc). This repo runs apollo with postgraphile, and add basic model subscription to the schema.  
For a table `users` (type `User`) `UserAdded, UserUpdated(id:Int), UserUpdatedAll, UserDeleted` are created for the subscription endpoints. 

### Motivation
PostGraphile itself is capable of subscription, but you have to run it as library, (start postgraphile server), this capability is lost when you "use PostGraphile as schema" and put in Apollo Server. For good reasons, there are times that you would like to utilize some ApolloServer's ability. This is to demo how to systematically setup the subscription for every table and use ApolloServer + graphql-ws as subscription server. 

#### SubProblem this repo try to solve: Performance on broadcast.
The Graphql subscription actually execute the subscription query when it receives the trigger, this means in a large server with 1000 clients subscribed to `UserAdded`(just an example), when this event is triggered, there will be at least 1000 SQL queries executed for each client. This is definitely a performance pain point and should be resolved. This repo demo a solution. A detailed explaination about this demo can be found [here](https://hansololai.github.io/advance-GraphQL-subscription-in-detail/)

### Install
clone this repo and add a `.env` file in root directoy with 
```sh
DATABASE_URL=postgres://... # postgresql connection string
```
Then run `yarn install` and `yarn run start`.
