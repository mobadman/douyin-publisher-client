using System;
using System.Windows.Forms;

internal static class NativeDialogHarness
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        using (OpenFileDialog dialog = new OpenFileDialog())
        {
            dialog.Title = "打开";
            dialog.Filter = "图片文件|*.jpg;*.jpeg;*.png";
            return dialog.ShowDialog() == DialogResult.OK ? 0 : 1;
        }
    }
}
