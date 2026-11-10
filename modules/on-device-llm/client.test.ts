import { describe, expect, it } from 'vite-plus/test';

import { createOnDeviceModel, OnDeviceModelError, type OnDeviceLLMNativeModule } from './client';

function nativeRejecting(error: Error | string): OnDeviceLLMNativeModule {
  return {
    availability: () => 'available',
    generate: async () => {
      throw error;
    },
  };
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

describe('createOnDeviceModel', () => {
  it('reports unsupported and rejects as unavailable without the native module', async () => {
    const model = createOnDeviceModel(null);

    expect(model.availability()).toBe('unsupported');
    await expect(model.generate({ instructions: 'i', prompt: 'p' })).rejects.toMatchObject({
      name: 'OnDeviceModelError',
      code: 'unavailable',
    });
  });

  it('passes known availability states through and folds unknown ones into unsupported', () => {
    const states = [
      'available',
      'deviceNotEligible',
      'appleIntelligenceNotEnabled',
      'modelNotReady',
    ];

    for (const state of states) {
      const model = createOnDeviceModel({ availability: () => state, generate: async () => '' });

      expect(model.availability()).toBe(state);
    }

    const future = createOnDeviceModel({
      availability: () => 'somethingNew',
      generate: async () => '',
    });

    expect(future.availability()).toBe('unsupported');
  });

  it('sends the default token budget and returns the completion', async () => {
    const calls: [string, string, number][] = [];

    const model = createOnDeviceModel({
      availability: () => 'available',
      generate: async (instructions, prompt, maximumResponseTokens) => {
        calls.push([instructions, prompt, maximumResponseTokens]);

        return 'done';
      },
    });

    await expect(model.generate({ instructions: 'be brief', prompt: 'hi' })).resolves.toBe('done');
    await model.generate({ instructions: 'i', prompt: 'p', maximumResponseTokens: 64.7 });
    expect(calls).toEqual([
      ['be brief', 'hi', 400],
      ['i', 'p', 64],
    ]);
  });

  it('maps native exception codes to OnDeviceModelError codes', async () => {
    const codes = [
      'unavailable',
      'guardrail',
      'contextWindow',
      'unsupportedLanguage',
      'rateLimited',
      'busy',
    ];

    for (const code of codes) {
      const native = codedError(code, `native ${code}`);

      const rejection = createOnDeviceModel(nativeRejecting(native)).generate({
        instructions: 'i',
        prompt: 'p',
      });

      await expect(rejection).rejects.toBeInstanceOf(OnDeviceModelError);
      await expect(rejection).rejects.toMatchObject({
        code,
        message: `native ${code}`,
        cause: native,
      });
    }
  });

  it('maps unknown codes, uncoded errors, and non-errors to failed', async () => {
    const rejections = [codedError('ERR_SOMETHING', 'x'), new Error('plain'), 'thrown string'];

    for (const rejection of rejections) {
      await expect(
        createOnDeviceModel(nativeRejecting(rejection)).generate({
          instructions: 'i',
          prompt: 'p',
        }),
      ).rejects.toMatchObject({ code: 'failed' });
    }
  });
});
