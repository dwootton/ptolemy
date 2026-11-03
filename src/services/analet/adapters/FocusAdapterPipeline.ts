import { pipeline } from '../../pipeline/operators';
import { PipelineDefinition } from '../../pipeline/types';
import { createGenerateRelatedIdeasStage } from '../../pipeline/stages/RelatedAnaletsStages';
import { createIdeaToCellQLStage } from '../../pipeline/stages/IdeaToCellQL';
import { createBaseAnaletStage } from '../../pipeline/stages/FramingStages';

export function buildFocusRelatedPipeline(opts: { seed: { type: 'bearing' | 'analet'; name?: string; cellQL?: string }; count?: number; datasetName?: string; datasetContext?: string }): PipelineDefinition {
  const generateIdeas = createGenerateRelatedIdeasStage({ seed: opts.seed, count: opts.count || 5 });
  const translate = createIdeaToCellQLStage({ datasetName: opts.datasetName, datasetContext: opts.datasetContext });
  const toBase = createBaseAnaletStage();

  return pipeline('FocusRelatedAnalets')
    .via(generateIdeas)
    .flatMap('perIdea', (ideas) =>
      pipeline('IdeaBranch')
        .flatMap('eachIdea', (idea: any) =>
          pipeline('Translate')
            .via(translate)
            .flatMap('analetToBase', (analet: any) =>
              pipeline('ToBase')
                .via(toBase)
                .aggregate('collectBase')
                .build()
            )
            .build()
        )
        .build()
    )
    .aggregate('collectAll')
    .build();
}


