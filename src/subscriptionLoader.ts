import DataLoader from 'dataloader';
import { delegateToSchema } from '@graphql-tools/delegate'
import { dbPool } from './configs/db'


function isFieldNode(n: any) {
  if ((n).name) return true;
  return false;
}
const mergeReturnNodes = (returnNodes: any) => {
  const setOfFields: any = {};
  returnNodes.forEach((node: any) => {
    if (node.selectionSet) {
      const {
        selectionSet: { selections },
      } = node;
      selections.forEach((selection: any) => {
        if (isFieldNode(selection)) {
          const {
            name: { value },
            selectionSet,
          } = selection;
          if (setOfFields[value]) {
            // This field is already in the output, merge it if necessary
            if (selectionSet) {
              setOfFields[value] = mergeReturnNodes([setOfFields[value], selection]);
            } // Otherwise, leave it.
          } else {
            // This field is not in the output, put it in
            setOfFields[value] = selection;
          }
        }
      });
    }
  });
  // Convert setOfFields to a fieldNode
  const template = returnNodes[0];
  const { selectionSet: templateSelectionSet } = template;
  const newSelectionSet = {
    ...templateSelectionSet,
    selections: Object.values(setOfFields),
    kind: 'SelectionSet',
  };
  return { ...template, selectionSet: newSelectionSet };
};



const dataLoaders: { [x: string]: DataLoader<any, any> } = {};


const getBroadcastDataLoader = (id: string, rootField: string, context: any, schema: any) => {
  const key = `subscriptionQuery:${rootField}:${id}`;
  if (!dataLoaders[key]) {
    dataLoaders[key] = new DataLoader(async (infos) => {
      // merge all infos
      const allNodes = infos.map((i) => i.fieldNodes[0]);
      const mergedNode = mergeReturnNodes(allNodes);
      const newInfo = { ...infos[0], fieldNodes: [mergedNode] };
      // add pgClient
      const pgClient = await dbPool.connect();
      try {
        const response = await delegateToSchema({
          context: { pgClient },
          info: newInfo,
          schema: schema,
          operation: 'query',
          fieldName: rootField,
          args: { id },
        });

        // if we have security concern, we would split the union data
        // into different object for each client, but for now we don't do that
        return infos.map(() => response);
      } finally {
        pgClient.release();
      }

    });
  }
  return dataLoaders[key];
}

export const transformSelectionSet = async (id: string, context: any,
  rootField: string, info: any, schema: any) => {
  const loader = getBroadcastDataLoader(id, rootField, context, schema);
  return loader.load(info);
}