import AppKit
import Foundation

let desktop = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let logoURL = desktop.appendingPathComponent("build/icon.png")
let assets = desktop.appendingPathComponent("installer/assets")
guard let logo = NSBitmapImageRep(data: try Data(contentsOf: logoURL)), let logoImage = logo.cgImage else {
  fatalError("Cannot read Oristrat application icon at \(logoURL.path)")
}

func bitmap(width: Int, height: Int, draw: () -> Void) -> Data {
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: rep) else {
    fatalError("Cannot create installer image")
  }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()
  draw()
  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()
  guard let data = rep.representation(using: .png, properties: [:]) else {
    fatalError("Cannot encode installer image")
  }
  return data
}

func label(_ value: String, size: CGFloat, color: NSColor, weight: NSFont.Weight = .semibold) -> NSAttributedString {
  NSAttributedString(string: value, attributes: [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
  ])
}

func drawBrand(scale: CGFloat, dark: Bool) {
  let ink = dark ? NSColor.white : NSColor(calibratedWhite: 0.12, alpha: 1)
  let inverted = dark ? NSColor(calibratedWhite: 0.12, alpha: 1) : NSColor.white
  let scaled = { (value: CGFloat) -> CGFloat in value * scale }
  NSGraphicsContext.current!.cgContext.draw(logoImage,
    in: CGRect(x: scaled(262), y: scaled(100), width: scaled(76), height: scaled(76)))
  let name = label("Oristrat AI", size: scaled(27), color: ink)
  let badge = label("STEM", size: scaled(15), color: inverted, weight: .bold)
  let badgeWidth = badge.size().width + scaled(20)
  let groupWidth = name.size().width + scaled(10) + badgeWidth
  let start = (scaled(600) - groupWidth) / 2
  name.draw(at: NSPoint(x: start, y: scaled(55)))
  let badgeX = start + name.size().width + scaled(10)
  ink.setFill()
  NSBezierPath(roundedRect: NSRect(x: badgeX, y: scaled(56), width: badgeWidth, height: scaled(25)),
    xRadius: scaled(4), yRadius: scaled(4)).fill()
  badge.draw(at: NSPoint(x: badgeX + scaled(10), y: scaled(59)))
}

for (name, scale, dark) in [
  ("brand", 1, false), ("brand-2x", 2, false),
  ("brand-dark", 1, true), ("brand-dark-2x", 2, true),
] {
  let data = bitmap(width: 600 * scale, height: 196 * scale) {
    drawBrand(scale: CGFloat(scale), dark: dark)
  }
  try data.write(to: assets.appendingPathComponent("\(name).png"))
}

let sidebar = bitmap(width: 164, height: 314) {
  NSColor(calibratedRed: 0.975, green: 0.981, blue: 0.997, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: 164, height: 314).fill()
  NSGraphicsContext.current!.cgContext.draw(logoImage,
    in: CGRect(x: 28, y: 124, width: 108, height: 108))
  let name = label("Oristrat AI", size: 17, color: NSColor(calibratedWhite: 0.12, alpha: 1))
  name.draw(at: NSPoint(x: (164 - name.size().width) / 2, y: 88))
  let stem = label("STEM", size: 12, color: NSColor(calibratedWhite: 0.31, alpha: 1), weight: .bold)
  stem.draw(at: NSPoint(x: (164 - stem.size().width) / 2, y: 68))
}
try sidebar.write(to: assets.appendingPathComponent("uninstaller-sidebar.png"))
