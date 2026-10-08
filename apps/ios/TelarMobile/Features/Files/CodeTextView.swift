import SwiftUI
import UIKit

struct CodeColours {
    let text: String
    let runs: [(NSRange, UIColor)]

    init?(_ highlighted: AttributedString?, text: String) {
        guard let highlighted else { return nil }
        self.text = text
        runs = highlighted.runs.compactMap { run in
            let colour = run[AttributeScopes.UIKitAttributes.ForegroundColorAttribute.self]
                ?? run[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self].map { UIColor($0) }
            return colour.map { (NSRange(run.range, in: highlighted), $0) }
        }
    }
}

struct CodeTextView: UIViewRepresentable {
    let text: String
    let colours: CodeColours?
    let editable: Bool
    let wrap: Bool
    let findRequest: Int
    let onEdit: (String) -> Void
    let onSideways: (Bool) -> Void

    func makeUIView(context: Context) -> CodeUITextView {
        let view = CodeUITextView()
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: CodeUITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        view.wrap = wrap
        if view.text != text, view.markedTextRange == nil { view.load(text) }
        if let colours, view.unpainted || coordinator.painted?.text != colours.text, colours.text == view.text {
            view.paint(colours)
            coordinator.painted = colours
        }
        if view.isEditable != editable {
            view.isEditable = editable
            if editable { DispatchQueue.main.async { view.becomeFirstResponder() } }
        }
        if coordinator.findRequest != findRequest {
            coordinator.findRequest = findRequest
            DispatchQueue.main.async { view.findInteraction?.presentFindNavigator(showingReplace: false) }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CodeTextView
        var findRequest: Int
        var painted: CodeColours?
        private var sideways = false

        init(_ parent: CodeTextView) {
            self.parent = parent
            findRequest = parent.findRequest
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.onEdit(textView.text)
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            let next = scrollView.contentOffset.x > 0
            guard next != sideways else { return }
            sideways = next
            parent.onSideways(next)
        }
    }
}

final class CodeUITextView: UITextView, NSTextStorageDelegate {
    let codeFont = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .monospacedSystemFont(ofSize: 13, weight: .regular))
    let gutterFont = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .monospacedSystemFont(ofSize: 12, weight: .regular))
    private(set) var lines = LineIndex("")
    private(set) var unpainted = true
    var wrap = false {
        didSet { if wrap != oldValue { applyWrap() } }
    }

    private let storage = NSTextStorage()
    private let gutter = LineGutterView()
    private var widestColumns = 0
    private lazy var advance = ("0" as NSString).size(withAttributes: [.font: codeFont]).width
    private lazy var digitAdvance = ("0" as NSString).size(withAttributes: [.font: gutterFont]).width

    private lazy var base: [NSAttributedString.Key: Any] = {
        let style = NSMutableParagraphStyle()
        style.tabStops = []
        style.defaultTabInterval = advance * CGFloat(CodeLayout.tabStop)
        style.lineSpacing = 2
        return [.font: codeFont, .foregroundColor: UIColor(Theme.text), .paragraphStyle: style]
    }()

    init() {
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        super.init(frame: .zero, textContainer: container)
        storage.delegate = self
        backgroundColor = UIColor(Theme.codeBackground)
        isEditable = false
        isFindInteractionEnabled = true
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        smartDashesType = .no
        smartInsertDeleteType = .no
        keyboardDismissMode = .interactive
        alwaysBounceVertical = true
        textContainer.lineFragmentPadding = 0
        typingAttributes = base
        gutter.textView = self
        addSubview(gutter)
        applyWrap()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("never loaded from a nib") }

    var gutterWidth: CGFloat { CGFloat(max(2, String(lines.count).count)) * digitAdvance + 16 }

    private var wideWidth: CGFloat {
        textContainerInset.left + CodeLayout.contentWidth(columns: widestColumns, advance: advance) + textContainerInset.right
    }

    override var contentSize: CGSize {
        get { super.contentSize }
        set { super.contentSize = CGSize(width: wrap ? newValue.width : max(newValue.width, wideWidth), height: newValue.height) }
    }

    override func layoutSubviews() {
        let left = gutterWidth + 8
        if textContainerInset.left != left {
            textContainerInset = UIEdgeInsets(top: 8, left: left, bottom: 8, right: 12)
        }
        super.layoutSubviews()
        if !wrap, contentSize.width < wideWidth { contentSize = super.contentSize }
        gutter.frame = CGRect(x: contentOffset.x, y: contentOffset.y, width: gutterWidth, height: bounds.height)
        bringSubviewToFront(gutter)
        gutter.setNeedsDisplay()
    }

    func load(_ text: String) {
        widestColumns = 0
        unpainted = true
        inputDelegate?.selectionWillChange(self)
        inputDelegate?.textWillChange(self)
        let caret = min(selectedRange.location, (text as NSString).length)
        storage.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: NSAttributedString(string: text, attributes: base))
        selectedRange = NSRange(location: caret, length: 0)
        inputDelegate?.textDidChange(self)
        inputDelegate?.selectionDidChange(self)
        undoManager?.removeAllActions()
    }

    func paint(_ colours: CodeColours) {
        guard markedTextRange == nil else { return }
        let length = storage.length
        storage.beginEditing()
        storage.setAttributes(base, range: NSRange(location: 0, length: length))
        for (range, colour) in colours.runs where NSMaxRange(range) <= length {
            storage.addAttribute(.foregroundColor, value: colour, range: range)
        }
        storage.endEditing()
        unpainted = false
    }

    func textStorage(_ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorage.EditActions, range editedRange: NSRange, changeInLength delta: Int) {
        guard editedMask.contains(.editedCharacters) else { return }
        let string = textStorage.string as NSString
        lines = LineIndex(string)
        let paragraphs = string.paragraphRange(for: editedRange)
        widestColumns = max(widestColumns, CodeLayout.widestLineColumns(string.substring(with: paragraphs)))
        setNeedsLayout()
    }

    private func applyWrap() {
        textContainer.widthTracksTextView = wrap
        if wrap {
            textContainer.size = CGSize(width: max(0, bounds.width - textContainerInset.left - textContainerInset.right), height: .greatestFiniteMagnitude)
            contentOffset.x = 0
        } else {
            textContainer.size = CGSize(width: 1_000_000, height: CGFloat.greatestFiniteMagnitude)
        }
        showsHorizontalScrollIndicator = !wrap
        contentSize = super.contentSize
        setNeedsLayout()
    }
}

private final class LineGutterView: UIView {
    weak var textView: CodeUITextView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(Theme.codeBackground)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        contentMode = .redraw
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("never loaded from a nib") }

    override func draw(_ rect: CGRect) {
        guard let view = textView else { return }
        let layout = view.layoutManager
        let container = view.textContainer
        let inset = view.textContainerInset
        let top = view.contentOffset.y
        let shift = inset.top - top + view.codeFont.ascender - view.gutterFont.ascender
        let attributes: [NSAttributedString.Key: Any] = [.font: view.gutterFont, .foregroundColor: UIColor(Theme.textMuted)]

        func number(_ line: Int, at y: CGFloat) {
            let label = String(line) as NSString
            let width = label.size(withAttributes: attributes).width
            label.draw(at: CGPoint(x: bounds.width - 8 - width, y: y + shift), withAttributes: attributes)
        }

        let visible = CGRect(x: 0, y: top - inset.top, width: container.size.width, height: bounds.height)
        let glyphs = layout.glyphRange(forBoundingRect: visible, in: container)
        layout.enumerateLineFragments(forGlyphRange: glyphs) { fragment, _, _, range, _ in
            if let line = view.lines.line(startingAt: layout.characterIndexForGlyph(at: range.location)) {
                number(line, at: fragment.minY)
            }
        }
        if layout.extraLineFragmentTextContainer != nil {
            number(view.lines.count, at: layout.extraLineFragmentRect.minY)
        }
    }
}
