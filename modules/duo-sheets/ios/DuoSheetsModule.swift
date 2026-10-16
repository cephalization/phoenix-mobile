import ExpoModulesCore
import UIKit

/// Exposes `UISheetPresentationController.preferredPlacement` (iOS 27) to
/// JavaScript. react-native-screens configures the sheet controller but has no
/// prop for placement, and the controller must be set before presentation to
/// avoid a visible move, so the module intercepts `present(_:animated:completion:)`
/// for form sheets and applies the app's preferred placement there.
public class DuoSheetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuoSheets")

    Function("setPreferredPlacement") { (placement: String) in
      SheetPlacement.shared.preferred = placement
      SheetPlacement.shared.installIfNeeded()
    }
  }
}

final class SheetPlacement {
  static let shared = SheetPlacement()

  /// One of `automatic`, `leading`, `center`, `trailing`.
  var preferred = "automatic"
  private var installed = false

  func installIfNeeded() {
    guard !installed else { return }
    installed = true

    let original = #selector(UIViewController.present(_:animated:completion:))
    let replacement = #selector(UIViewController.duoSheets_present(_:animated:completion:))

    guard let originalMethod = class_getInstanceMethod(UIViewController.self, original),
      let replacementMethod = class_getInstanceMethod(UIViewController.self, replacement)
    else { return }

    method_exchangeImplementations(originalMethod, replacementMethod)
  }

  func apply(to controller: UIViewController) {
    guard #available(iOS 27.0, *), controller.modalPresentationStyle == .formSheet,
      let sheet = controller.sheetPresentationController
    else { return }

    switch preferred {
    case "leading": sheet.preferredPlacement = .leading
    case "center": sheet.preferredPlacement = .center
    case "trailing": sheet.preferredPlacement = .trailing
    default: sheet.preferredPlacement = .automatic
    }
  }
}

extension UIViewController {
  @objc func duoSheets_present(
    _ viewController: UIViewController, animated: Bool, completion: (() -> Void)?
  ) {
    SheetPlacement.shared.apply(to: viewController)
    // Implementations are exchanged, so this calls the original `present`.
    duoSheets_present(viewController, animated: animated, completion: completion)
  }
}
