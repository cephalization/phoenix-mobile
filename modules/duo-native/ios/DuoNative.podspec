Pod::Spec.new do |s|
  s.name           = 'DuoNative'
  s.version        = '1.0.0'
  s.summary        = 'iPhone Duo layout metrics and trailing form sheets'
  s.description    = 'Reports reserved regions, size class, and the vertical bar edge to JavaScript, and sets UISheetPresentationController.preferredPlacement for form sheets presented by react-native-screens.'
  s.author         = 'Phoenix Mobile'
  s.homepage       = 'https://docs.expo.dev/modules/get-started/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
