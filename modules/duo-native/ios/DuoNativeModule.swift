import ExpoModulesCore
import UIKit

/// iPhone Duo support that react-native-screens and Expo do not expose:
///
/// - `LayoutMetrics`, a view that reports its size class, the vertical system
///   bar's edge, its safe area, and the active reserved regions (the fold and
///   camera occlusions) in its own coordinate space.
/// - `setPreferredPlacement`, which applies `UISheetPresentationController.preferredPlacement`
///   (iOS 27) to form sheets as they are presented. react-native-screens has no
///   prop for placement, and the controller must be configured before
///   presentation to avoid a visible move.
public class DuoNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuoNative")

    Constants {
      // The native split navigator needs the react-native-screens v5 split host.
      ["supportsSplitColumns": NSClassFromString("RNSSplitHostComponentView") != nil]
    }

    Function("setPreferredPlacement") { (placement: String) in
      SheetPlacement.shared.preferred = placement
      SheetPlacement.shared.installIfNeeded()
    }

    View(DuoLayoutMetricsView.self) {
      Events("onMetricsChange")
    }
  }
}

/// Reports geometry in this view's coordinate space, including system
/// reservations that safe-area insets cannot represent, such as the fold.
/// Adapted from T3 Code's `T3LayoutMetricsView` (MIT, T3 Tools Inc.).
final class DuoLayoutMetricsView: ExpoView {
  let onMetricsChange = EventDispatcher()
  private var lastMetrics: NSDictionary?
  /// `nil` until UIKit says whether this window has a hinge.
  private var hasHinge: Bool? = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self]) {
        (view: DuoLayoutMetricsView, _: UITraitCollection) in
        view.publishMetrics()
      }
    }
    // The hinge, reserved-region, and vertical-bar APIs ship in the iOS 27.1
    // SDK, whose UIKit is 9127.0.85; gate on the SDK as well as the OS.
    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      hasHinge = nil
      addInteraction(
        UIHingeInteraction { [weak self] _, update in
          guard let self, self.window != nil else { return }
          // Capability survives temporary detachment and does not follow the angle,
          // but a fold changes the active division region, so republish either way.
          self.hasHinge = self.hasHinge == true || update.hinge != nil
          self.publishMetrics()
        })
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
        (view: DuoLayoutMetricsView, _: UITraitCollection) in
        view.publishMetrics()
      }
    }
    #endif
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    lastMetrics = nil
    assumeNoHingeIfSilent()
    publishMetrics()
  }

  /// UIKit sends hinge updates only on devices with a hinge, so an ordinary
  /// iPhone would never publish without this fallback.
  private func assumeNoHingeIfSilent() {
    guard window != nil, hasHinge == nil else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      guard let self, self.window != nil, self.hasHinge == nil else { return }
      self.hasHinge = false
      self.publishMetrics()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    publishMetrics()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    publishMetrics()
  }

  private func publishMetrics() {
    guard window != nil, bounds.width > 0, bounds.height > 0, let hasHinge else { return }
    var verticalBarEdge = "none"
    var regions: [[String: Any]] = []
    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      let rtl = effectiveUserInterfaceLayoutDirection == .rightToLeft
      switch traitCollection.verticalBarEdge {
      case .leading: verticalBarEdge = rtl ? "right" : "left"
      case .trailing: verticalBarEdge = rtl ? "left" : "right"
      default: break
      }
      for kind in [UIView.ReservedRegion.Kind.division, .occlusion] {
        for region in reservedRegions(kind: kind) where region.isActive {
          let frame = region.frame.intersection(bounds)
          guard !frame.isNull, !frame.isEmpty else { continue }
          regions.append([
            "kind": kind == .division ? "division" : "occlusion",
            "x": frame.minX, "y": frame.minY,
            "width": frame.width, "height": frame.height,
          ])
        }
      }
    }
    #endif
    let metrics: [String: Any] = [
      "width": bounds.width, "height": bounds.height,
      "hasHinge": hasHinge,
      "horizontalSizeClass": traitCollection.horizontalSizeClass == .regular ? "regular" : "compact",
      "verticalBarEdge": verticalBarEdge,
      "safeArea": [
        "top": safeAreaInsets.top, "bottom": safeAreaInsets.bottom,
        "left": safeAreaInsets.left, "right": safeAreaInsets.right,
      ],
      "reservedRegions": regions,
    ]
    let next = metrics as NSDictionary
    guard lastMetrics?.isEqual(next) != true else { return }
    lastMetrics = next
    onMetricsChange(metrics)
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
    let replacement = #selector(UIViewController.duoNative_present(_:animated:completion:))

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
  @objc func duoNative_present(
    _ viewController: UIViewController, animated: Bool, completion: (() -> Void)?
  ) {
    SheetPlacement.shared.apply(to: viewController)
    // Implementations are exchanged, so this calls the original `present`.
    duoNative_present(viewController, animated: animated, completion: completion)
  }
}
