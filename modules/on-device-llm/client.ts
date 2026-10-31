import { isJsonString } from '../../src/lib/json';

export type OnDeviceModelAvailability =
  | 'available'
  | 'deviceNotEligible'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'unsupported';

export type OnDeviceModelErrorCode =
  | 'unavailable'
  | 'guardrail'
  | 'contextWindow'
  | 'unsupportedLanguage'
  | 'rateLimited'
  | 'busy'
  | 'failed';

export type OnDeviceGenerationRequest = {
  instructions: string;
  prompt: string;
  maximumResponseTokens?: number;
};

/** The surface `OnDeviceLLMModule.swift` exposes. */
export type OnDeviceLLMNativeModule = {
  availability: () => string;
  generate: (
    instructions: string,
    prompt: string,
    maximumResponseTokens: number,
  ) => Promise<string>;
};

export class OnDeviceModelError extends Error {
  code: OnDeviceModelErrorCode;

  constructor(code: OnDeviceModelErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OnDeviceModelError';
    this.code = code;
  }
}

const DEFAULT_MAXIMUM_RESPONSE_TOKENS = 400;

function availabilityFrom(value: string): OnDeviceModelAvailability {
  switch (value) {
    case 'available':
    case 'deviceNotEligible':
    case 'appleIntelligenceNotEnabled':
    case 'modelNotReady':
      return value;
    default:
      return 'unsupported';
  }
}

function errorCodeFrom(value: string): OnDeviceModelErrorCode {
  switch (value) {
    case 'unavailable':
    case 'guardrail':
    case 'contextWindow':
    case 'unsupportedLanguage':
    case 'rateLimited':
    case 'busy':
      return value;
    default:
      return 'failed';
  }
}

/** Map a native rejection, whose `code` comes from `OnDeviceLLMException`, to the JS error. */
function errorFromNative(error: Error): OnDeviceModelError {
  const code = 'code' in error && isJsonString(error.code) ? errorCodeFrom(error.code) : 'failed';

  return new OnDeviceModelError(code, error.message, { cause: error });
}

/**
 * Binds the JS contract to a native module, or to `null` where it is absent
 * (Expo Go, Android, web). The native module is the seam tests replace.
 */
export function createOnDeviceModel(nativeModule: OnDeviceLLMNativeModule | null) {
  function availability(): OnDeviceModelAvailability {
    return nativeModule === null ? 'unsupported' : availabilityFrom(nativeModule.availability());
  }

  async function generate(request: OnDeviceGenerationRequest): Promise<string> {
    if (nativeModule === null) {
      throw new OnDeviceModelError(
        'unavailable',
        'The on-device model is not available on this platform.',
      );
    }

    const maximumResponseTokens = Math.max(
      1,
      Math.floor(request.maximumResponseTokens ?? DEFAULT_MAXIMUM_RESPONSE_TOKENS),
    );

    try {
      return await nativeModule.generate(
        request.instructions,
        request.prompt,
        maximumResponseTokens,
      );
    } catch (error) {
      if (error instanceof Error) throw errorFromNative(error);

      throw new OnDeviceModelError('failed', String(error));
    }
  }

  return { availability, generate };
}
