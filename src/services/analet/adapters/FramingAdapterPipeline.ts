import { pipeline } from '../../pipeline/operators';
import { PipelineDefinition } from '../../pipeline/types';
import { createExtractStakeholdersStage, createGenerateGoalsStage, createGenerateIdeasStage, createBaseAnaletStage, createEnrichAnaletStage, type FramingDatasetInput } from '../../pipeline/stages/FramingStages';
import { createIdeaToCellQLStage } from '../../pipeline/stages/IdeaToCellQL';

export function buildFramingPipeline(ds: FramingDatasetInput): PipelineDefinition {
  const extractStakeholders = createExtractStakeholdersStage(ds);
  const generateGoals = createGenerateGoalsStage(ds);
  const generateIdeas = createGenerateIdeasStage(ds);
  const transformIdea = createIdeaToCellQLStage({ datasetName: ds.datasetName, datasetContext: ds.datasetContext, columnDefinitions: ds.columnDefinitions });
  const toBaseAnalet = createBaseAnaletStage();
  const enrichAnalet = createEnrichAnaletStage(ds);

  return pipeline('FramingPipeline')
    .via(extractStakeholders)
    .flatMap('stakeholderBranches', (stakeholder) =>
      pipeline('StakeholderBranch')
        .via({ ...generateGoals, name: `generateAnalysisGoals:${stakeholder.role || 'unknown'}` })
        .flatMap('goalBranches', (goals) =>
          pipeline('GoalListToIdeas')
            .flatMap('perGoal', (goal: any) =>
              pipeline('GoalBranch')
                .via({ ...generateIdeas, name: `generateAnaletIdeas:${goal.goalTitle || 'goal'}` })
                .flatMap('perIdea', (ideas) =>
                  pipeline('IdeaBranch')
                    .flatMap('eachIdea', (idea: any) =>
                      pipeline('TransformIdea')
                        .via({ ...transformIdea, name: `ideaToCellQL:${(idea.statement || '').slice(0, 12)}` })
                        .flatMap('analetsToBase', (analets) =>
                          pipeline('ToBaseAnalet')
                            .flatMap('eachDSLAnalet', (a: any) =>
                              pipeline('PerAnalet')
                                .via(toBaseAnalet)
                                .via(enrichAnalet)
                                .aggregate('collectEnriched')
                                .build()
                            )
                            .build()
                        )
                        .aggregate('collectCellQL')
                        .build()
                    )
                    .build()
                )
                .build()
            )
            .build()
        )
        .build()
    )
    .aggregate('collectAll')
    .build();
}


