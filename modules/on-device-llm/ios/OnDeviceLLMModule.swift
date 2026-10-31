import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple's on-device Foundation Models for JavaScript:
///
/// - `availability`, the state of `SystemLanguageModel.default`, or
///   `unsupported` where the framework or OS is missing.
/// - `generate`, a single-turn, greedy text completion. Each call uses a new
///   `LanguageModelSession` so no transcript accumulates in the context window.
///
/// FoundationModels is weak-linked (see the podspec) and every use sits behind
/// `canImport` and `#available`, so the app still launches on iOS 16.4.
public class OnDeviceLLMModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnDeviceLLM")

    Function("availability") { () -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return OnDeviceLLM.availability()
      }
      #endif
      return "unsupported"
    }

    AsyncFunction("generate") {
      (instructions: String, prompt: String, maximumResponseTokens: Int) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await OnDeviceLLM.generate(
          instructions: instructions,
          prompt: prompt,
          maximumResponseTokens: maximumResponseTokens
        )
      }
      #endif
      throw OnDeviceLLMException(code: "unavailable", reason: "Foundation Models requires iOS 26 or later.")
    }
  }
}

/// A rejection whose `code` JavaScript maps to `OnDeviceModelError.code`.
final class OnDeviceLLMException: Exception, @unchecked Sendable {
  init(code: String, reason: String) {
    super.init(name: "OnDeviceLLMException", description: reason, code: code)
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
enum OnDeviceLLM {
  static func availability() -> String {
    switch SystemLanguageModel.default.availability {
    case .available:
      return "available"
    case .unavailable(.deviceNotEligible):
      return "deviceNotEligible"
    case .unavailable(.appleIntelligenceNotEnabled):
      return "appleIntelligenceNotEnabled"
    case .unavailable(.modelNotReady):
      return "modelNotReady"
    case .unavailable:
      return "unsupported"
    }
  }

  static func generate(instructions: String, prompt: String, maximumResponseTokens: Int) async throws -> String {
    let state = availability()
    guard state == "available" else {
      throw OnDeviceLLMException(code: "unavailable", reason: "The on-device model is unavailable (\(state)).")
    }

    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: maximumResponseTokens)

    do {
      return try await session.respond(to: prompt, options: options).content
    } catch let error as OnDeviceLLMException {
      throw error
    } catch {
      throw exception(for: error)
    }
  }

  private static func exception(for error: Error) -> OnDeviceLLMException {
    let reason = error.localizedDescription

    // iOS 27 moves most failures to `LanguageModelError` and
    // `LanguageModelSession.Error`; Swift 6.4 ships with the iOS 27 SDK.
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      if let error = error as? LanguageModelError {
        switch error {
        case .contextSizeExceeded:
          return OnDeviceLLMException(code: "contextWindow", reason: reason)
        case .rateLimited:
          return OnDeviceLLMException(code: "rateLimited", reason: reason)
        case .guardrailViolation, .refusal:
          return OnDeviceLLMException(code: "guardrail", reason: reason)
        case .unsupportedLanguageOrLocale:
          return OnDeviceLLMException(code: "unsupportedLanguage", reason: reason)
        default:
          return OnDeviceLLMException(code: "failed", reason: reason)
        }
      }
      if error is SystemLanguageModel.Error {
        return OnDeviceLLMException(code: "unavailable", reason: reason)
      }
      if let error = error as? LanguageModelSession.Error, error == .concurrentRequests {
        return OnDeviceLLMException(code: "busy", reason: reason)
      }
    }
    #endif

    if let error = error as? LanguageModelSession.GenerationError {
      switch error {
      case .exceededContextWindowSize:
        return OnDeviceLLMException(code: "contextWindow", reason: reason)
      case .assetsUnavailable:
        return OnDeviceLLMException(code: "unavailable", reason: reason)
      case .guardrailViolation, .refusal:
        return OnDeviceLLMException(code: "guardrail", reason: reason)
      case .unsupportedLanguageOrLocale:
        return OnDeviceLLMException(code: "unsupportedLanguage", reason: reason)
      case .rateLimited:
        return OnDeviceLLMException(code: "rateLimited", reason: reason)
      case .concurrentRequests:
        return OnDeviceLLMException(code: "busy", reason: reason)
      default:
        return OnDeviceLLMException(code: "failed", reason: reason)
      }
    }

    return OnDeviceLLMException(code: "failed", reason: reason)
  }
}
#endif
