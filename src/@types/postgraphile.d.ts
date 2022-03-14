import { Build } from 'postgraphile';
import {
  PgAttribute,
  PgProc,
  PgClass,
  PgConstraint,
  PgExtension,
  PgType,
  PgNamespace,
} from 'graphile-build-pg';
import { PgIndex } from 'graphile-build-pg/node8plus/plugins/PgIntrospectionPlugin';

export interface GraphilePgConstraint extends Omit<PgConstraint, 'foreignClass' | 'class'> {
  foreignClass: GraphilePgClass | void;
  class: GraphilePgClass;
}
export interface GraphilePgClass extends Omit<PgClass, 'constraints'> {
  constraints: PgConstraint[];
}
export interface GraphilePgIntrospection {
  __pgVersion: number;
  attribute: PgAttribute[];
  attributeByClassIdAndNum: { [classId: string]: { [num: string]: PgAttribute } };
  class: GraphilePgClass[];
  classById: { [x: string]: GraphilePgClass };
  constraint: GraphilePgConstraint[];
  extension: PgExtension[];
  extensionById: { [x: string]: PgExtension };
  index: PgIndex[];
  namespace: PgNamespace[];
  namespaceById: { [x: string]: PgNamespace };
  procedure: PgProc[];
  type: PgType[];
  typeById: { [x: string]: PgType };
}
export interface GraphileBuild extends Build {
  pgIntrospectionResultsByKind: GraphilePgIntrospection;
}
