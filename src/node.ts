import { Axis } from "./axis.js";

export interface AlignmentNode<T = unknown> {
  axis: Axis;
  payload?: T;
  children?: [AlignmentNode<T>, AlignmentNode<T>];
}
