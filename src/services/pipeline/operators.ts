import { PipelineDefinition, PipelineNodeDef, StageDef } from './types';

export function pipeline(name: string): PipelineBuilder {
  return new PipelineBuilder(name);
}

export class PipelineBuilder {
  private def: PipelineDefinition;

  constructor(name: string) {
    this.def = { name, nodes: [] };
  }

  via<I, O>(stage: StageDef<I, O>): this {
    const node: PipelineNodeDef<I, O> = { type: 'via', name: stage.name, stage };
    this.def.nodes.push(node);
    return this;
  }

  flatMap(name: string, buildChild: (input: any) => PipelineDefinition): this {
    const node: PipelineNodeDef = { type: 'flatMap', name, buildChild };
    this.def.nodes.push(node);
    return this;
  }

  aggregate(name: string): this {
    const node: PipelineNodeDef = { type: 'aggregate', name };
    this.def.nodes.push(node);
    return this;
  }

  build(): PipelineDefinition {
    return this.def;
  }
}


