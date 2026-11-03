/**
 * Conditional study component exports
 * This module conditionally exports study components based on build-time feature flags
 * 
 * Note: The components will always be included in the bundle due to static imports,
 * but they will only be used/rendered when STUDY_MODE is enabled
 */

import { FeatureFlags } from '../utils/featureFlags';

// Static imports (will be included in bundle but only used when study mode is enabled)
import { StudyFinishButton as _StudyFinishButton } from './StudyFinishButton';
import { StudyParticipantInput as _StudyParticipantInput } from './StudyApplicationController/StudyParticipantInput';
import { StudyProgressDisplay as _StudyProgressDisplay } from './StudyApplicationController/StudyProgressDisplay';

// Conditional exports - only return components when study mode is enabled
export const StudyFinishButton = FeatureFlags.STUDY_MODE_ENABLED ? _StudyFinishButton : null;
export const StudyParticipantInput = FeatureFlags.STUDY_MODE_ENABLED ? _StudyParticipantInput : null;
export const StudyProgressDisplay = FeatureFlags.STUDY_MODE_ENABLED ? _StudyProgressDisplay : null;