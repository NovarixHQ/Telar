import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import WebView from "react-native-webview";

export type StreamEvent = { type: "frame"; width: number; height: number } | { type: "error" };

const quote = (text: string) => JSON.stringify(text).replace(/</g, "\\u003c");

// WebKit decodes multipart JPEG natively in an <img>, so frames never cross the JS bridge; only size changes do.
const page = (url: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}img{display:block;width:100%;height:100%;-webkit-user-select:none;-webkit-touch-callout:none}</style></head>
<body><img id="s" alt=""><script>
const img=document.getElementById("s");let w=0,h=0;
const post=(m)=>window.ReactNativeWebView.postMessage(JSON.stringify(m));
const check=()=>{if(img.naturalWidth&&(img.naturalWidth!==w||img.naturalHeight!==h)){w=img.naturalWidth;h=img.naturalHeight;post({type:"frame",width:w,height:h});}};
img.onload=check;img.onerror=()=>post({type:"error"});setInterval(check,500);img.src=${quote(url)};
</script></body></html>`;

export function parseStreamEvent(data: string): StreamEvent | undefined {
  try {
    const value = JSON.parse(data) as Partial<{ type: string; width: number; height: number }>;
    if (value.type === "error") return { type: "error" };
    if (value.type === "frame" && typeof value.width === "number" && typeof value.height === "number") return { type: "frame", width: value.width, height: value.height };
  } catch {}
  return undefined;
}

/** One simulator's live MJPEG stream, drawn to fill its box. */
export function StreamView({ url, style, onEvent }: { url: string; style: StyleProp<ViewStyle>; onEvent: (event: StreamEvent) => void }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: page(url) }}
      onMessage={({ nativeEvent }) => {
        const event = parseStreamEvent(nativeEvent.data);
        if (event) onEvent(event);
      }}
      onContentProcessDidTerminate={() => onEvent({ type: "error" })}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || !request.isTopFrame}
      pointerEvents="none"
      scrollEnabled={false}
      bounces={false}
      style={[styles.web, style]}
      containerStyle={style}
      contentInsetAdjustmentBehavior="never"
      dataDetectorTypes="none"
      allowsLinkPreview={false}
      incognito
    />
  );
}

const styles = StyleSheet.create({ web: { backgroundColor: "#000" } });
