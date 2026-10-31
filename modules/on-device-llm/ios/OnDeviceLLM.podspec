Pod::Spec.new do |s|
  s.name           = 'OnDeviceLLM'
  s.version        = '1.0.0'
  s.summary        = "Apple's on-device Foundation Models for JavaScript"
  s.description    = 'Reports SystemLanguageModel availability and runs single-turn, greedy text generation with a fresh LanguageModelSession per call. FoundationModels is weak-linked so the app still launches on iOS releases without it.'
  s.author         = 'Phoenix Mobile'
  s.homepage       = 'https://docs.expo.dev/modules/get-started/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.weak_frameworks = 'FoundationModels'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
