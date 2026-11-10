import { requireOptionalNativeModule } from 'expo';

import { createOnDeviceModel, type OnDeviceLLMNativeModule } from './client';

export {
  OnDeviceModelError,
  type OnDeviceGenerationRequest,
  type OnDeviceModelAvailability,
  type OnDeviceModelErrorCode,
} from './client';

const onDeviceModel = createOnDeviceModel(
  requireOptionalNativeModule<OnDeviceLLMNativeModule>('OnDeviceLLM'),
);

/** Synchronous; 'unsupported' on Android, Expo Go (module missing), and iOS < 26. */
export const onDeviceModelAvailability = onDeviceModel.availability;

/** Free-text completion with greedy sampling. Rejects with OnDeviceModelError. */
export const generateOnDevice = onDeviceModel.generate;
