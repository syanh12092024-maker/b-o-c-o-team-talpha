"use client";

import { useState, useRef } from "react";
import { UploadCloud, CheckCircle, RefreshCcw, Save, Copy, Loader2, Image as ImageIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function SalesScriptTab() {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string>("");
    
    const [productName, setProductName] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    
    const [script, setScript] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setImagePreview(base64);
            setImageBase64(base64);
            setMimeType(file.type);
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setImagePreview(base64);
            setImageBase64(base64);
            setMimeType(file.type);
        };
        reader.readAsDataURL(file);
    };

    const clearImage = () => {
        setImagePreview(null);
        setImageBase64(null);
        setMimeType("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleGenerate = async () => {
        if (!imageBase64) {
            setError("Vui lòng tải ảnh sản phẩm lên trước!");
            return;
        }
        
        setLoading(true);
        setError(null);
        setSaveMessage(null);
        
        try {
            const res = await fetch("/api/auus1/sales-script", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageBase64, mimeType, productName })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || "Gặp lỗi khi tạo kịch bản");
            
            setScript(data.script);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!script) return;
        
        setSaving(true);
        try {
            const res = await fetch("/api/auus1/sales-script/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ script, productName: productName || "Moi" })
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Lỗi lưu file");
            
            setSaveMessage(data.message + " (" + data.filePath + ")");
            setTimeout(() => setSaveMessage(null), 5000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = () => {
        if (script) {
            navigator.clipboard.writeText(script);
            setSaveMessage("Đã copy vào clipboard!");
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <PenTool className="h-6 w-6 text-indigo-400" /> 
                    Sales Script Maker
                </h2>
                <p className="text-slate-400">Tự động phân tích hình ảnh bằng <b>Gemini 1.5 PRO</b>, lên kịch bản Taglish Telesale và Facebook Ads.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* CỘT NHẬP KHOẢN (Input) */}
                <div className="col-span-1 space-y-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Tên sản phẩm (tuỳ chọn)</label>
                            <input 
                                type="text"
                                placeholder="VD: Gối massage cổ"
                                value={productName}
                                onChange={e => setProductName(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <p className="text-xs text-slate-500 mt-1">Giúp file được lưu với tên chuẩn hơn, ví dụ: <code>Kich_Ban_GoiMassageCo_Bilingual.md</code></p>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Ảnh sản phẩm / Vấn đề</label>
                            <div 
                                onDragOver={e => e.preventDefault()}
                                onDrop={handleDrop}
                                onClick={() => !imagePreview && fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-6 transition-all ${
                                    imagePreview ? "border-slate-600 bg-slate-900/50" : "border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 cursor-pointer"
                                }`}
                            >
                                <input 
                                    ref={fileInputRef}
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={handleFileChange}
                                />
                                
                                {imagePreview ? (
                                    <div className="w-full relative group">
                                        <img src={imagePreview} alt="Preview" className="w-full h-auto rounded-lg object-contain max-h-60" />
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); clearImage(); }}
                                            className="absolute top-2 right-2 bg-rose-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition shadow-lg hover:bg-rose-600"
                                            title="Xoá ảnh"
                                        >
                                            <RefreshCcw className="h-4 w-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <UploadCloud className="h-10 w-10 text-indigo-400 mx-auto mb-3" />
                                        <h3 className="font-semibold text-slate-200">Kéo thả ảnh vào đây</h3>
                                        <p className="text-sm text-slate-400 mt-1">Hoặc click để chọn file</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <button 
                            onClick={handleGenerate}
                            disabled={loading || !imageBase64}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg flex justify-center items-center gap-2 transition"
                        >
                            {loading ? (
                                <><Loader2 className="h-5 w-5 animate-spin" /> Đang dùng AI phân tích...</>
                            ) : (
                                <><ImageIcon className="h-5 w-5" /> Soạn Kịch Bản</>
                            )}
                        </button>
                        
                        {error && (
                            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm">
                                {error}
                            </div>
                        )}
                        
                        {saveMessage && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-sm flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 shrink-0" />
                                {saveMessage}
                            </div>
                        )}
                    </div>
                </div>
                
                {/* CỘT KẾT QUẢ (Output) */}
                <div className="col-span-1 lg:col-span-2">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl h-[80vh] flex flex-col overflow-hidden">
                        <div className="bg-slate-800 border-b border-slate-700 p-3 px-4 flex items-center justify-between shrink-0">
                            <span className="font-semibold text-slate-200 flex items-center gap-2">
                                {script ? "✅ Kết quả Kịch Bản" : "📝 Chờ dữ liệu..."}
                            </span>
                            
                            {script && (
                                <div className="flex gap-2">
                                    <button 
                                        onClick={handleCopy}
                                        className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-sm flex gap-1.5 items-center transition"
                                    >
                                        <Copy className="h-4 w-4" /> Copy
                                    </button>
                                    <button 
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm flex gap-1.5 items-center shadow-lg transition"
                                    >
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                        Lưu file vật lý (.md)
                                    </button>
                                </div>
                            )}
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 text-slate-300 prose prose-invert prose-indigo max-w-none">
                            {script ? (
                                <ReactMarkdown>
                                    {script}
                                </ReactMarkdown>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50 space-y-4">
                                    <ImageIcon className="h-16 w-16" />
                                    <p>Tải ảnh lên và bấm nút "Soạn Kịch Bản" để bắt đầu</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                
            </div>
        </div>
    );
}

// Custom icon hack 
function PenTool(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}
