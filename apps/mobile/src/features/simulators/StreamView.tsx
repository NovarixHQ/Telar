import { StyleSheet } from "react-native";
import WebView from "react-native-webview";

export type StreamEvent = { type: "frame"; width: number; height: number } | { type: "error" };

const quote = (text: string) => JSON.stringify(text).replace(/</g, "\\u003c");

// WebKit decodes multipart JPEG natively in an <img>, so frames never cross the JS bridge; only size changes do.
const page = (url: string, rotation: number) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
img{position:absolute;left:50%;top:50%;width:100vw;height:100vh;object-fit:contain;transform:translate(-50%,-50%) rotate(${rotation}deg);-webkit-user-select:none;-webkit-touch-callout:none}
${Math.abs(rotation) === 90 ? "img{width:100vh;height:100vw}" : ""}</style></head>
<body><img id="s" alt=""><script>
const img=document.getElementById("s");let w=0,h=0;
const post=(m)=>window.ReactNativeWebView.postMessage(JSON.stringify(m));
const check=()=>{if(img.naturalWidth&&(img.naturalWidth!==w||img.naturalHeight!==h)){w=img.naturalWidth;h=img.naturalHeight;post({type:"frame",width:w,height:h});}};
img.onload=check;img.onerror=()=>post({type:"error"});setInterval(check,500);img.src=${quote(url)};
</script></body></html>`;

function parseStreamEvent(data: string): StreamEvent | undefined {
  try {
    const value = JSON.parse(data) as Partial<{ type: string; width: number; height: number }>;
    if (value.type === "error") return { type: "error" };
    if (value.type === "frame" && typeof value.width === "number" && typeof value.height === "number") return { type: "frame", width: value.width, height: value.height };
  } catch {}
  return undefined;
}

/** One simulator's live MJPEG stream, aspect-fitted into the whole of its parent and turned by `rotation` degrees; a new rotation reloads it. */
export function StreamView({ url, rotation, onEvent }: { url: string; rotation: number; onEvent: (event: StreamEvent) => void }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: page(url, rotation) }}
      onMessage={({ nativeEvent }) => {
        const event = parseStreamEvent(nativeEvent.data);
        if (event) onEvent(event);
      }}
      onContentProcessDidTerminate={() => onEvent({ type: "error" })}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || !request.isTopFrame}
      pointerEvents="none"
      scrollEnabled={false}
      bounces={false}
      style={styles.web}
      containerStyle={StyleSheet.absoluteFill}
      contentInsetAdjustmentBehavior="never"
      dataDetectorTypes="none"
      allowsLinkPreview={false}
      incognito
    />
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: "transparent" } });
