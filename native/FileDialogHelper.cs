using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

internal static class FileDialogHelper
{
    private const int DefaultTimeoutMilliseconds = 15000;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attachThreadId, uint attachToThreadId, bool attach);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

    private delegate bool EnumWindowProc(IntPtr windowHandle, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern int GetDlgCtrlID(IntPtr windowHandle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr windowHandle);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr windowHandle);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr windowHandle, out RECT rectangle);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr windowHandle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr windowHandle, uint message, IntPtr wordParameter, string longParameter);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr windowHandle, uint message, IntPtr wordParameter, IntPtr longParameter);

    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint InputMouse = 0;
    private const uint KeyUp = 0x0002;
    private const uint KeyUnicode = 0x0004;
    private const uint InputKeyboard = 1;
    private const byte VirtualControl = 0x11;
    private const byte VirtualAlt = 0x12;
    private const byte VirtualA = 0x41;
    private const byte VirtualL = 0x4c;
    private const byte VirtualN = 0x4e;
    private const byte VirtualEnter = 0x0d;
    private const uint WindowSetText = 0x000c;
    private const uint ButtonClick = 0x00f5;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT Mouse;
        [FieldOffset(0)] public KEYBDINPUT Keyboard;
        [FieldOffset(0)] public HARDWAREINPUT Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint Message;
        public ushort ParameterLow;
        public ushort ParameterHigh;
    }

    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length >= 1 && string.Equals(args[0], "inspect-upload", StringComparison.OrdinalIgnoreCase))
            {
                string inspectName = args.Length >= 2 ? args[1] : "上传封面";
                string inspectTitle = args.Length >= 3 ? args[2] : "抖音创作者中心";
                WriteResult(true, InspectChromeUploadElements(inspectName, inspectTitle), null);
                return 0;
            }
            if (args.Length >= 1 && string.Equals(args[0], "inspect-dialog", StringComparison.OrdinalIgnoreCase))
            {
                int inspectTimeout = args.Length >= 2 ? ParseTimeout(args[1]) : 5000;
                IntPtr inspected = WaitForForegroundOpenDialog(inspectTimeout);
                WriteResult(true, InspectNativeDialog(inspected), null);
                return 0;
            }
            if (args.Length >= 2 && string.Equals(args[0], "select-open-dialog", StringComparison.OrdinalIgnoreCase))
            {
                string existingFilePath = Path.GetFullPath(args[1]);
                int existingTimeout = args.Length >= 3 ? ParseTimeout(args[2]) : DefaultTimeoutMilliseconds;
                ValidateImage(existingFilePath);
                IntPtr foregroundDialog = WaitForForegroundOpenDialog(existingTimeout);
                SetFileNameAndOpenNative(foregroundDialog, existingFilePath, existingTimeout);
                WriteResult(true, "现有标准文件选择窗口已完成", existingFilePath);
                return 0;
            }
            if (args.Length >= 8 && string.Equals(args[0], "select-at", StringComparison.OrdinalIgnoreCase))
            {
                string positionedFilePath = Path.GetFullPath(args[1]);
                string positionedWindowTitle = args[2];
                double pageX = ParsePositiveDouble(args[3], "上传控件横坐标");
                double pageY = ParsePositiveDouble(args[4], "上传控件纵坐标");
                double viewportWidth = ParsePositiveDouble(args[5], "网页可视区宽度");
                double viewportHeight = ParsePositiveDouble(args[6], "网页可视区高度");
                int positionedTimeout = ParseTimeout(args[7]);
                ValidateImage(positionedFilePath);

                string clickedElement;
                ClickChromeDocumentPoint(positionedWindowTitle, pageX, pageY, viewportWidth, viewportHeight,
                    Math.Min(positionedTimeout, 8000), out clickedElement);
                AutomationElement positionedDialog;
                try
                {
                    positionedDialog = WaitForChromeFileDialog(positionedTimeout);
                }
                catch (Exception error)
                {
                    throw new InvalidOperationException("已经按网页定位点击竖封面上传区域，但没有打开 Chrome 标准“打开”对话框。点击位置下的控件："
                        + clickedElement + "。" + error.Message);
                }
                SetFileName(positionedDialog, positionedFilePath);
                InvokeOpen(positionedDialog);
                WaitForDialogClosed(positionedDialog, positionedTimeout);
                WriteResult(true, "已通过 Chrome 标准“打开”对话框选择封面", positionedFilePath);
                return 0;
            }
            if (args.Length < 2 || !string.Equals(args[0], "select", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("用法：FileDialogHelper.exe select <文件路径> [网页控件名称] [窗口标题] [超时毫秒]");
            }

            string filePath = Path.GetFullPath(args[1]);
            string targetName = args.Length >= 3 ? args[2] : "上传封面";
            string windowTitle = args.Length >= 4 ? args[3] : "抖音创作者中心";
            int timeout = args.Length >= 5 ? ParseTimeout(args[4]) : DefaultTimeoutMilliseconds;
            ValidateImage(filePath);

            ClickChromeElement(targetName, windowTitle, Math.Min(timeout, 8000));
            AutomationElement dialog = WaitForChromeFileDialog(timeout);
            SetFileName(dialog, filePath);
            InvokeOpen(dialog);
            WaitForDialogClosed(dialog, timeout);

            WriteResult(true, "系统文件选择窗口已完成", filePath);
            return 0;
        }
        catch (Exception error)
        {
            WriteResult(false, error.Message, null);
            return 1;
        }
    }

    private sealed class ClickTarget
    {
        public AutomationElement Window;
        public AutomationElement Element;
        public System.Windows.Rect Bounds;
    }

    private static void ClickChromeDocumentPoint(string windowTitle, double pageX, double pageY,
        double viewportWidth, double viewportHeight, int timeout, out string clickedElement)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeout)
        {
            AutomationElementCollection windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                try
                {
                    if (window.Current.NativeWindowHandle == 0 || !window.Current.IsEnabled) continue;
                    Process process = Process.GetProcessById(window.Current.ProcessId);
                    if (!string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) continue;
                    string title = window.Current.Name ?? string.Empty;
                    if (title.IndexOf(windowTitle, StringComparison.OrdinalIgnoreCase) < 0) continue;

                    AutomationElement document = FindLargestVisibleDocument(window);
                    if (document == null) continue;
                    System.Windows.Rect documentBounds = document.Current.BoundingRectangle;
                    double scaleX = documentBounds.Width / viewportWidth;
                    double scaleY = documentBounds.Height / viewportHeight;
                    int screenX = (int)Math.Round(documentBounds.Left + pageX * scaleX);
                    int screenY = (int)Math.Round(documentBounds.Top + pageY * scaleY);
                    if (screenX < documentBounds.Left || screenX >= documentBounds.Right
                        || screenY < documentBounds.Top || screenY >= documentBounds.Bottom)
                    {
                        throw new InvalidOperationException("网页提供的上传控件坐标超出 Chrome 内容区，未执行点击");
                    }

                    IntPtr windowHandle = new IntPtr(window.Current.NativeWindowHandle);
                    ForceForegroundWindow(windowHandle);
                    Stopwatch foregroundTimer = Stopwatch.StartNew();
                    while (GetForegroundWindow() != windowHandle && foregroundTimer.ElapsedMilliseconds < 1500) Thread.Sleep(50);
                    if (GetForegroundWindow() != windowHandle)
                    {
                        throw new InvalidOperationException("Windows 拒绝把抖音 Chrome 窗口切换到前台，未执行点击");
                    }
                    Thread.Sleep(150);
                    AutomationElement pointElement = AutomationElement.FromPoint(new System.Windows.Point(screenX, screenY));
                    clickedElement = pointElement == null ? "未知"
                        : (pointElement.Current.Name ?? string.Empty) + "/" + pointElement.Current.ControlType.ProgrammaticName
                            + "/" + (pointElement.Current.ClassName ?? string.Empty)
                            + "/坐标" + screenX + "," + screenY;
                    ClickAt(screenX, screenY, "竖封面上传区域");
                    return;
                }
                catch (ElementNotAvailableException) { }
                catch (ArgumentException) { }
            }
            Thread.Sleep(150);
        }
        clickedElement = "未点击";
        throw new TimeoutException("没有找到标题包含“" + windowTitle + "”的 Chrome 网页内容区");
    }

    private static AutomationElement FindLargestVisibleDocument(AutomationElement window)
    {
        AutomationElementCollection documents = window.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
        AutomationElement best = null;
        double bestArea = 0;
        foreach (AutomationElement document in documents)
        {
            try
            {
                if (!document.Current.IsEnabled || document.Current.IsOffscreen) continue;
                System.Windows.Rect bounds = document.Current.BoundingRectangle;
                double area = bounds.Width * bounds.Height;
                if (bounds.IsEmpty || area <= bestArea) continue;
                best = document;
                bestArea = area;
            }
            catch (ElementNotAvailableException) { }
        }
        return best;
    }

    private static string InspectChromeUploadElements(string targetName, string windowTitle)
    {
        List<string> results = new List<string>();
        AutomationElementCollection windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
        foreach (AutomationElement window in windows)
        {
            try
            {
                if (window.Current.NativeWindowHandle == 0) continue;
                Process process = Process.GetProcessById(window.Current.ProcessId);
                if (!string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) continue;
                string title = window.Current.Name ?? string.Empty;
                if (title.IndexOf(windowTitle, StringComparison.OrdinalIgnoreCase) < 0) continue;
                AutomationElementCollection named = window.FindAll(TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.NameProperty, targetName));
                for (int index = 0; index < named.Count; index++)
                {
                    AutomationElement element = named[index];
                    StringBuilder item = new StringBuilder();
                    item.Append("目标").Append(index + 1).Append(DescribeElement(element));
                    AutomationElement parent = TreeWalker.ControlViewWalker.GetParent(element);
                    for (int level = 1; level <= 5 && parent != null; level++)
                    {
                        item.Append(" <- 父").Append(level).Append(DescribeElement(parent));
                        parent = TreeWalker.ControlViewWalker.GetParent(parent);
                    }
                    results.Add(item.ToString());
                }
            }
            catch (ElementNotAvailableException) { }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
        }
        return results.Count == 0 ? "没有找到目标 Chrome 页面中的“" + targetName + "”" : string.Join("；", results.ToArray());
    }

    private static string DescribeElement(AutomationElement element)
    {
        System.Windows.Rect bounds = element.Current.BoundingRectangle;
        object invoke;
        object selection;
        bool hasInvoke = element.TryGetCurrentPattern(InvokePattern.Pattern, out invoke);
        bool hasSelection = element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selection);
        return "[名称=" + (element.Current.Name ?? string.Empty)
            + ",类型=" + element.Current.ControlType.ProgrammaticName
            + ",类=" + (element.Current.ClassName ?? string.Empty)
            + ",ID=" + (element.Current.AutomationId ?? string.Empty)
            + ",可用=" + element.Current.IsEnabled
            + ",屏外=" + element.Current.IsOffscreen
            + ",范围=" + Math.Round(bounds.Left) + "," + Math.Round(bounds.Top) + "," + Math.Round(bounds.Width) + "," + Math.Round(bounds.Height)
            + ",Invoke=" + hasInvoke + ",Selection=" + hasSelection + "]";
    }

    private static IntPtr ClickChromeElement(string targetName, string windowTitle, int timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        List<string> diagnostics = new List<string>();
        while (timer.ElapsedMilliseconds < timeout)
        {
            List<ClickTarget> targets = new List<ClickTarget>();
            AutomationElementCollection windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                try
                {
                    if (window.Current.NativeWindowHandle == 0 || !window.Current.IsEnabled) continue;
                    Process process = Process.GetProcessById(window.Current.ProcessId);
                    if (!string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) continue;
                    string currentTitle = window.Current.Name ?? string.Empty;
                    if (currentTitle.IndexOf(windowTitle, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    AutomationElementCollection named = window.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.NameProperty, targetName));
                    if (named.Count > 0) diagnostics.Add((window.Current.Name ?? "Chrome") + "=" + named.Count);
                    foreach (AutomationElement element in named)
                    {
                        if (!element.Current.IsEnabled || element.Current.IsOffscreen) continue;
                        System.Windows.Rect bounds = element.Current.BoundingRectangle;
                        if (bounds.IsEmpty || bounds.Width < 2 || bounds.Height < 2) continue;
                        AddUniqueTarget(targets, new ClickTarget { Window = window, Element = element, Bounds = bounds });
                    }
                }
                catch (ElementNotAvailableException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }

            if (targets.Count == 1)
            {
                ClickTarget target = targets[0];
                IntPtr windowHandle = new IntPtr(target.Window.Current.NativeWindowHandle);
                ForceForegroundWindow(windowHandle);
                Stopwatch foregroundTimer = Stopwatch.StartNew();
                while (GetForegroundWindow() != windowHandle && foregroundTimer.ElapsedMilliseconds < 1500) Thread.Sleep(50);
                if (GetForegroundWindow() != windowHandle)
                {
                    throw new InvalidOperationException("Windows 拒绝把目标 Chrome 窗口切换到前台，未执行鼠标点击");
                }
                Thread.Sleep(150);
                int x = (int)Math.Round(target.Bounds.Left + target.Bounds.Width / 2.0);
                int y = (int)Math.Round(target.Bounds.Top + target.Bounds.Height / 2.0);
                ClickAt(x, y, "Chrome 的“" + targetName + "”控件");
                return windowHandle;
            }
            if (targets.Count > 1) throw new InvalidOperationException("检测到多个可见的“" + targetName + "”控件，无法安全判断点击目标");
            Thread.Sleep(150);
        }
        string observed = diagnostics.Count == 0 ? "指定 Chrome 窗口的可访问性树中没有同名控件" : string.Join("；", diagnostics.ToArray());
        throw new TimeoutException("没有在标题包含“" + windowTitle + "”的 Chrome 中找到可点击的“" + targetName + "”控件。观察结果：" + observed);
    }

    private static IntPtr WaitForForegroundWindowChange(IntPtr chromeWindow, int timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        IntPtr candidate = IntPtr.Zero;
        long stableSince = 0;
        while (timer.ElapsedMilliseconds < timeout)
        {
            IntPtr foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero && foreground != chromeWindow)
            {
                if (foreground != candidate)
                {
                    candidate = foreground;
                    stableSince = timer.ElapsedMilliseconds;
                }
                if (timer.ElapsedMilliseconds - stableSince >= 300) return foreground;
            }
            Thread.Sleep(50);
        }
        throw new TimeoutException("点击“上传封面”后，前台窗口没有从 Chrome 切换到系统文件选择窗口");
    }

    private static IntPtr WaitForForegroundOpenDialog(int timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        string lastObserved = "没有前台窗口";
        while (timer.ElapsedMilliseconds < timeout)
        {
            IntPtr foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero)
            {
                string title = ReadWindowText(foreground);
                string className = ReadWindowClass(foreground);
                lastObserved = "标题=" + (string.IsNullOrWhiteSpace(title) ? "空" : title) + "，窗口类=" + className;
                if (IsNativeOpenDialog(foreground)) return foreground;
            }
            List<IntPtr> candidates = new List<IntPtr>();
            EnumWindows(delegate(IntPtr windowHandle, IntPtr parameter)
            {
                if (IsWindowVisible(windowHandle) && IsWindowEnabled(windowHandle) && IsNativeOpenDialog(windowHandle))
                {
                    candidates.Add(windowHandle);
                }
                return true;
            }, IntPtr.Zero);
            if (candidates.Count == 1) return candidates[0];
            if (candidates.Count > 1) throw new InvalidOperationException("检测到多个Windows标准“打开”对话框，无法安全判断目标窗口");
            Thread.Sleep(100);
        }
        throw new TimeoutException("文件选择窗口已经由网页触发，但前台窗口不是 Windows 标准“打开”对话框。观察结果：" + lastObserved);
    }

    private static bool IsNativeOpenDialog(IntPtr windowHandle)
    {
        if (!string.Equals(ReadWindowClass(windowHandle), "#32770", StringComparison.Ordinal)) return false;
        string title = ReadWindowText(windowHandle).Replace("&", string.Empty).Trim();
        return title.Equals("打开", StringComparison.OrdinalIgnoreCase)
            || title.StartsWith("打开 ", StringComparison.OrdinalIgnoreCase)
            || title.Equals("Open", StringComparison.OrdinalIgnoreCase)
            || title.StartsWith("Open ", StringComparison.OrdinalIgnoreCase);
    }

    private static string InspectNativeDialog(IntPtr dialogWindow)
    {
        IntPtr fileName = FindNativeFileNameEdit(dialogWindow);
        IntPtr openButton = FindNativeOpenButton(dialogWindow);
        return "已识别 Windows 标准“打开”对话框；文件名=" + DescribeNativeControl(fileName)
            + "；打开=" + DescribeNativeControl(openButton);
    }

    private static string DescribeNativeControl(IntPtr windowHandle)
    {
        if (windowHandle == IntPtr.Zero) return "未找到";
        RECT bounds;
        GetWindowRect(windowHandle, out bounds);
        return "类=" + ReadWindowClass(windowHandle)
            + "，ID=" + GetDlgCtrlID(windowHandle)
            + "，文字=" + ReadWindowText(windowHandle)
            + "，范围=" + bounds.Left + "," + bounds.Top + "," + (bounds.Right - bounds.Left) + "," + (bounds.Bottom - bounds.Top);
    }

    private static List<IntPtr> EnumerateNativeChildren(IntPtr parent)
    {
        List<IntPtr> children = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr child, IntPtr parameter)
        {
            children.Add(child);
            return true;
        }, IntPtr.Zero);
        return children;
    }

    private static bool HasAncestorControlId(IntPtr windowHandle, IntPtr dialogWindow, int expectedId)
    {
        IntPtr current = windowHandle;
        for (int level = 0; level < 8 && current != IntPtr.Zero && current != dialogWindow; level++)
        {
            if (GetDlgCtrlID(current) == expectedId) return true;
            current = GetParent(current);
        }
        return false;
    }

    private static IntPtr FindNativeFileNameEdit(IntPtr dialogWindow)
    {
        RECT dialogBounds;
        GetWindowRect(dialogWindow, out dialogBounds);
        IntPtr best = IntPtr.Zero;
        long bestScore = long.MinValue;
        foreach (IntPtr child in EnumerateNativeChildren(dialogWindow))
        {
            if (!IsWindowVisible(child) || !IsWindowEnabled(child)) continue;
            if (!string.Equals(ReadWindowClass(child), "Edit", StringComparison.OrdinalIgnoreCase)) continue;
            RECT bounds;
            if (!GetWindowRect(child, out bounds)) continue;
            int width = bounds.Right - bounds.Left;
            int height = bounds.Bottom - bounds.Top;
            if (width < 80 || height < 12) continue;
            long score = width * 100L + Math.Max(0, bounds.Top - dialogBounds.Top);
            if (GetDlgCtrlID(child) == 1148) score += 1000000L;
            else if (HasAncestorControlId(child, dialogWindow, 1148)) score += 500000L;
            if (score <= bestScore) continue;
            best = child;
            bestScore = score;
        }
        return best;
    }

    private static IntPtr FindNativeOpenButton(IntPtr dialogWindow)
    {
        IntPtr named = IntPtr.Zero;
        foreach (IntPtr child in EnumerateNativeChildren(dialogWindow))
        {
            if (!IsWindowVisible(child) || !IsWindowEnabled(child)) continue;
            if (!string.Equals(ReadWindowClass(child), "Button", StringComparison.OrdinalIgnoreCase)) continue;
            if (GetDlgCtrlID(child) == 1) return child;
            string name = ReadWindowText(child).Replace("&", string.Empty).Trim();
            if (name.StartsWith("打开", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("Open", StringComparison.OrdinalIgnoreCase)) named = child;
        }
        return named;
    }

    private static void SetFileNameAndOpenNative(IntPtr dialogWindow, string filePath, int timeout)
    {
        IntPtr fileName = IntPtr.Zero;
        IntPtr openButton = IntPtr.Zero;
        Stopwatch controlsTimer = Stopwatch.StartNew();
        while (controlsTimer.ElapsedMilliseconds < timeout)
        {
            if (!IsWindow(dialogWindow)) throw new InvalidOperationException("等待文件名输入框时Windows文件选择窗口已经关闭");
            fileName = FindNativeFileNameEdit(dialogWindow);
            openButton = FindNativeOpenButton(dialogWindow);
            if (fileName != IntPtr.Zero && openButton != IntPtr.Zero) break;
            Thread.Sleep(100);
        }
        if (fileName == IntPtr.Zero || openButton == IntPtr.Zero)
        {
            throw new TimeoutException("Windows标准“打开”对话框已经出现，但等待原生“文件名”输入框和“打开”按钮超时；"
                + InspectNativeDialog(dialogWindow));
        }

        ForceForegroundWindow(dialogWindow);
        if (GetForegroundWindow() != dialogWindow) throw new InvalidOperationException("无法激活Windows标准“打开”对话框");
        AutomationElement fileNameElement = AutomationElement.FromHandle(fileName);
        object valuePatternObject;
        if (!fileNameElement.TryGetCurrentPattern(ValuePattern.Pattern, out valuePatternObject))
        {
            throw new InvalidOperationException("已定位原生“文件名”输入框，但该控件不支持写入");
        }
        ValuePattern valuePattern = (ValuePattern)valuePatternObject;
        fileNameElement.SetFocus();
        valuePattern.SetValue(filePath);
        string actual = valuePattern.Current.Value;
        if (!string.Equals(actual, filePath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("完整封面路径写入“文件名”输入框后回读不一致；实际为“" + actual + "”");
        }
        AutomationElement openButtonElement = AutomationElement.FromHandle(openButton);
        object invokePatternObject;
        if (openButtonElement.TryGetCurrentPattern(InvokePattern.Pattern, out invokePatternObject))
        {
            ((InvokePattern)invokePatternObject).Invoke();
        }
        else
        {
            // 部分 Windows 文件对话框虽然提供了原生 Button 句柄，却不通过
            // UI Automation 暴露 InvokePattern。此时直接向已经核验过的按钮
            // 发送 BM_CLICK，避免同一安装包在不同 Windows 环境中表现不一致。
            SendMessage(openButton, ButtonClick, IntPtr.Zero, IntPtr.Zero);
        }
        WaitForNativeDialogClosed(dialogWindow, timeout);
    }

    private static void WaitForNativeDialogClosed(IntPtr dialogWindow, int timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeout)
        {
            if (!IsWindow(dialogWindow)) return;
            Thread.Sleep(100);
        }
        throw new TimeoutException("已经写入完整封面路径并点击“打开”，但Windows文件选择窗口没有关闭");
    }

    private static string ReadWindowText(IntPtr windowHandle)
    {
        StringBuilder text = new StringBuilder(512);
        GetWindowText(windowHandle, text, text.Capacity);
        return text.ToString();
    }

    private static string ReadWindowClass(IntPtr windowHandle)
    {
        StringBuilder className = new StringBuilder(256);
        GetClassName(windowHandle, className, className.Capacity);
        return className.ToString();
    }

    private static void SetFullPathAndOpenWithKeyboard(IntPtr dialogWindow, string filePath, int timeout)
    {
        ForceForegroundWindow(dialogWindow);
        if (GetForegroundWindow() != dialogWindow) throw new InvalidOperationException("无法激活 Windows 标准“打开”对话框");
        SendShortcut(VirtualAlt, VirtualN);
        Thread.Sleep(200);
        SendShortcut(VirtualControl, VirtualA);
        SendUnicodeText(filePath);
        Thread.Sleep(150);
        PressKey(VirtualEnter);

        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeout)
        {
            if (!IsWindow(dialogWindow)) return;
            Thread.Sleep(100);
        }
        throw new TimeoutException("完整封面路径已经输入，但 Windows 标准“打开”对话框没有关闭");
    }

    private static void NavigateAndOpenWithKeyboard(IntPtr dialogWindow, string filePath, int timeout)
    {
        ForceForegroundWindow(dialogWindow);
        if (GetForegroundWindow() != dialogWindow) throw new InvalidOperationException("无法激活系统文件选择窗口");

        string directory = Path.GetDirectoryName(filePath);
        string fileName = Path.GetFileName(filePath);
        SendShortcut(VirtualControl, VirtualL);
        Thread.Sleep(150);
        SendShortcut(VirtualControl, VirtualA);
        SendUnicodeText(directory);
        PressKey(VirtualEnter);
        Thread.Sleep(700);

        SendShortcut(VirtualAlt, VirtualN);
        Thread.Sleep(150);
        SendShortcut(VirtualControl, VirtualA);
        SendUnicodeText(fileName);
        PressKey(VirtualEnter);

        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeout)
        {
            if (!IsWindow(dialogWindow)) return;
            Thread.Sleep(100);
        }
        throw new TimeoutException("已经输入目录和文件名，但系统文件选择窗口没有关闭");
    }

    private static void SendShortcut(byte modifier, byte key)
    {
        keybd_event(modifier, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, KeyUp, UIntPtr.Zero);
        keybd_event(modifier, 0, KeyUp, UIntPtr.Zero);
    }

    private static void ClickAt(int x, int y, string description)
    {
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("无法把鼠标移动到" + description);
        Thread.Sleep(250);
        INPUT[] down = new INPUT[1];
        down[0].Type = InputMouse;
        down[0].Data.Mouse.Flags = MouseLeftDown;
        if (SendInput(1, down, Marshal.SizeOf(typeof(INPUT))) != 1)
        {
            throw new InvalidOperationException("无法在" + description + "按下鼠标左键");
        }
        Thread.Sleep(80);
        INPUT[] up = new INPUT[1];
        up[0].Type = InputMouse;
        up[0].Data.Mouse.Flags = MouseLeftUp;
        if (SendInput(1, up, Marshal.SizeOf(typeof(INPUT))) != 1)
        {
            throw new InvalidOperationException("无法在" + description + "释放鼠标左键");
        }
    }

    private static void PressKey(byte key)
    {
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, KeyUp, UIntPtr.Zero);
    }

    private static void SendUnicodeText(string value)
    {
        foreach (char character in value)
        {
            INPUT[] inputs = new INPUT[2];
            inputs[0].Type = InputKeyboard;
            inputs[0].Data.Keyboard.ScanCode = character;
            inputs[0].Data.Keyboard.Flags = KeyUnicode;
            inputs[1].Type = InputKeyboard;
            inputs[1].Data.Keyboard.ScanCode = character;
            inputs[1].Data.Keyboard.Flags = KeyUnicode | KeyUp;
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != inputs.Length) throw new InvalidOperationException("向系统文件窗口输入 Unicode 路径失败");
        }
    }

    private static void ForceForegroundWindow(IntPtr windowHandle)
    {
        IntPtr foreground = GetForegroundWindow();
        uint currentThread = GetCurrentThreadId();
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        uint targetThread = GetWindowThreadProcessId(windowHandle, IntPtr.Zero);
        bool attachedForeground = foregroundThread != 0 && foregroundThread != currentThread
            && AttachThreadInput(currentThread, foregroundThread, true);
        bool attachedTarget = targetThread != 0 && targetThread != currentThread
            && AttachThreadInput(currentThread, targetThread, true);
        try
        {
            ShowWindow(windowHandle, 9);
            BringWindowToTop(windowHandle);
            SetForegroundWindow(windowHandle);
        }
        finally
        {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    private static void AddUniqueTarget(List<ClickTarget> targets, ClickTarget candidate)
    {
        double x = candidate.Bounds.Left + candidate.Bounds.Width / 2.0;
        double y = candidate.Bounds.Top + candidate.Bounds.Height / 2.0;
        foreach (ClickTarget existing in targets)
        {
            double existingX = existing.Bounds.Left + existing.Bounds.Width / 2.0;
            double existingY = existing.Bounds.Top + existing.Bounds.Height / 2.0;
            if (Math.Abs(existingX - x) < 3 && Math.Abs(existingY - y) < 3) return;
        }
        targets.Add(candidate);
    }

    private static int ParseTimeout(string value)
    {
        int timeout;
        if (!int.TryParse(value, out timeout) || timeout < 1000 || timeout > 60000)
        {
            throw new InvalidOperationException("文件窗口超时必须在1000至60000毫秒之间");
        }
        return timeout;
    }

    private static double ParsePositiveDouble(string value, string name)
    {
        double parsed;
        if (!double.TryParse(value, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out parsed) || parsed <= 0 || double.IsNaN(parsed) || double.IsInfinity(parsed))
        {
            throw new InvalidOperationException(name + "无效");
        }
        return parsed;
    }

    private static void ValidateImage(string filePath)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("封面图片不存在", filePath);
        string extension = Path.GetExtension(filePath).ToLowerInvariant();
        if (extension != ".jpg" && extension != ".jpeg" && extension != ".png")
        {
            throw new InvalidOperationException("封面图片扩展名只允许 jpg、jpeg 或 png");
        }

        byte[] header = new byte[8];
        using (FileStream stream = File.OpenRead(filePath))
        {
            if (stream.Read(header, 0, header.Length) < 3) throw new InvalidOperationException("封面图片内容为空或损坏");
        }
        bool jpeg = header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff;
        bool png = header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4e && header[3] == 0x47
            && header[4] == 0x0d && header[5] == 0x0a && header[6] == 0x1a && header[7] == 0x0a;
        if ((extension == ".png" && !png) || (extension != ".png" && !jpeg))
        {
            throw new InvalidOperationException("封面图片扩展名与真实文件格式不一致");
        }
    }

    private static AutomationElement WaitForChromeFileDialog(int timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        List<string> observedWindows = new List<string>();
        while (timer.ElapsedMilliseconds < timeout)
        {
            List<AutomationElement> candidates = new List<AutomationElement>();
            AutomationElementCollection windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                try
                {
                    if (!window.Current.IsEnabled || window.Current.NativeWindowHandle == 0) continue;
                    string className = window.Current.ClassName ?? string.Empty;
                    AutomationElement fileNameElement = FindFileNameElement(window);
                    AutomationElement openButton = FindOpenButton(window);
                    if (fileNameElement != null || openButton != null || className == "#32770")
                    {
                        string processName;
                        try { processName = Process.GetProcessById(window.Current.ProcessId).ProcessName; }
                        catch { processName = "未知进程"; }
                        string description = processName + "|" + className + "|" + (window.Current.Name ?? string.Empty)
                            + "|文件名=" + (fileNameElement != null ? "是" : "否")
                            + "|打开=" + (openButton != null ? "是" : "否");
                        if (!observedWindows.Contains(description)) observedWindows.Add(description);
                    }
                    if (fileNameElement == null || openButton == null) continue;
                    candidates.Add(window);
                }
                catch (ElementNotAvailableException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }

            if (candidates.Count == 1) return candidates[0];
            if (candidates.Count > 1) throw new InvalidOperationException("检测到多个带有“文件名”和“打开”控件的窗口，无法安全判断目标窗口");
            Thread.Sleep(150);
        }
        string observed = observedWindows.Count == 0 ? "未观察到带有文件名输入框或打开按钮的顶层窗口" : string.Join("；", observedWindows.ToArray());
        throw new TimeoutException("没有检测到可操作的 Windows 标准“打开”对话框。观察结果：" + observed);
    }

    private static AutomationElement FindFileNameElement(AutomationElement dialog)
    {
        AutomationElementCollection elements = dialog.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        AutomationElement fallback = null;
        foreach (AutomationElement element in elements)
        {
            try
            {
                string id = element.Current.AutomationId ?? string.Empty;
                string name = element.Current.Name ?? string.Empty;
                bool preferred = id == "FileNameControlHost" || id == "1148";
                bool named = name == "文件名:" || name == "文件名" || name.StartsWith("File name", StringComparison.OrdinalIgnoreCase);
                if (!preferred && !named) continue;

                AutomationElement editable = FindEditableElement(element);
                if (editable != null && preferred) return editable;
                if (editable != null) fallback = editable;
            }
            catch (ElementNotAvailableException) { }
        }
        return fallback;
    }

    private static AutomationElement FindEditableElement(AutomationElement element)
    {
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return element;
        AutomationElementCollection descendants = element.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        foreach (AutomationElement child in descendants)
        {
            if (child.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return child;
        }
        return null;
    }

    private static AutomationElement FindOpenButton(AutomationElement dialog)
    {
        AutomationElementCollection elements = dialog.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
        AutomationElement named = null;
        foreach (AutomationElement element in elements)
        {
            try
            {
                string id = element.Current.AutomationId ?? string.Empty;
                string name = (element.Current.Name ?? string.Empty).Replace("&", string.Empty).Trim();
                if (id == "1") return element;
                if (name.StartsWith("打开", StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("Open", StringComparison.OrdinalIgnoreCase)) named = element;
            }
            catch (ElementNotAvailableException) { }
        }
        return named;
    }

    private static void SetFileName(AutomationElement dialog, string filePath)
    {
        AutomationElement field = FindFileNameElement(dialog);
        if (field == null) throw new InvalidOperationException("文件选择窗口中没有找到“文件名”输入框");
        object pattern;
        if (!field.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
        {
            throw new InvalidOperationException("文件选择窗口的“文件名”输入框不支持写入");
        }
        field.SetFocus();
        ((ValuePattern)pattern).SetValue(filePath);
        string actual = ((ValuePattern)pattern).Current.Value;
        if (!string.Equals(actual, filePath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("文件路径写入系统窗口后回读不一致");
        }
    }

    private static void InvokeOpen(AutomationElement dialog)
    {
        AutomationElement button = FindOpenButton(dialog);
        if (button == null) throw new InvalidOperationException("文件选择窗口中没有找到“打开”按钮");
        object pattern;
        if (button.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
        {
            ((InvokePattern)pattern).Invoke();
            return;
        }
        IntPtr handle = new IntPtr(button.Current.NativeWindowHandle);
        if (handle != IntPtr.Zero && IsWindow(handle))
        {
            SendMessage(handle, ButtonClick, IntPtr.Zero, IntPtr.Zero);
            return;
        }
        throw new InvalidOperationException("文件选择窗口的“打开”按钮既不支持UI Automation调用，也没有可用的原生按钮句柄");
    }

    private static void WaitForDialogClosed(AutomationElement dialog, int timeout)
    {
        IntPtr windowHandle = new IntPtr(dialog.Current.NativeWindowHandle);
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeout)
        {
            if (!IsWindow(windowHandle)) return;
            Thread.Sleep(100);
        }
        throw new TimeoutException("点击“打开”后文件选择窗口没有关闭");
    }

    private static void WriteResult(bool ok, string message, string filePath)
    {
        Console.WriteLine("{\"ok\":" + (ok ? "true" : "false")
            + ",\"message\":\"" + JsonEscape(message) + "\""
            + (filePath == null ? string.Empty : ",\"filePath\":\"" + JsonEscape(filePath) + "\"") + "}");
    }

    private static string JsonEscape(string value)
    {
        if (value == null) return string.Empty;
        StringBuilder output = new StringBuilder();
        foreach (char character in value)
        {
            switch (character)
            {
                case '\\': output.Append("\\\\"); break;
                case '"': output.Append("\\\""); break;
                case '\r': output.Append("\\r"); break;
                case '\n': output.Append("\\n"); break;
                case '\t': output.Append("\\t"); break;
                default: output.Append(character); break;
            }
        }
        return output.ToString();
    }
}
