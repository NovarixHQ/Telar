Pod::Spec.new do |s|
  s.name           = 'TelarSwiftPairings'
  s.version        = '0.1.0'
  s.summary        = 'Reads the hosts and device tokens the earlier Swift app saved.'
  s.author         = 'Telar'
  s.homepage       = 'https://github.com/NovarixHQ/telar'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '18.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.swift'
end
