/** UIKit's horizontal size class from the window width: iPads below a half split and iPhones short of a Max in landscape are compact. */
export function isRegularWidth(width: number, pad: boolean): boolean {
  return width >= (pad ? 640 : 880);
}
