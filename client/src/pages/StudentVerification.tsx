
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";

// Assuming a Dialog component is available for alerts, e.g., from shadcn/ui
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from "@/components/ui/alert-dialog";

export default function StudentVerificationScreen() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"info" | "upload" | "email" | "subscription">("info");
  const [studentIdImage, setStudentIdImage] = useState<string | null>(null); // base64 string
  const [schoolEmail, setSchoolEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<"6months" | "1year" | null>(null);

  const submitVerification = trpc.student.submitVerification.useMutation();
  const verifyEmail = trpc.student.verifySchoolEmail.useMutation();
  const createSubscription = trpc.student.createSubscription.useMutation();
  const startTrial = trpc.student.startTrial.useMutation();

  const handleStartTrial = async () => {
    try {
      const result = await startTrial.mutateAsync();
      toast.success("试用已开始", {
        description: `您的 2 天免费试用已启动！到期时间：${new Date(result.endDate).toLocaleDateString("zh-CN")}`,
        action: {
          label: "开始探索",
          onClick: () => window.history.back(),
        },
      });
    } catch (error: any) {
      toast.error("错误", { description: error.message || "启动试用失败" });
    }
  };

  const handlePickImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      // remove data:image/jpeg;base64,
      const base64Data = base64.split(",")[1];
      setStudentIdImage(base64Data);
    };
    reader.onerror = (error) => {
        toast.error("错误", { description: "图片读取失败: " + error });
    }
    reader.readAsDataURL(file);
  };

  const handleSubmitStudentId = async () => {
    if (!studentIdImage) {
      toast.warning("提示", { description: "请上传学生证照片" });
      return;
    }

    try {
      const imageUrl = `data:image/jpeg;base64,${studentIdImage}`;
      
      await submitVerification.mutateAsync({
        studentIdImageUrl: imageUrl, // In a real app, upload to S3 first
        schoolEmail: schoolEmail || "temp@temp.edu",
        educationLevel: "university",
        schoolName: "Pending",
      });
      setStep("email");
      toast.success("提交成功", { description: "学生证已提交审核，请验证您的学校邮箱。" });
    } catch (error: any) {
      toast.error("错误", { description: error.message || "提交失败" });
    }
  };

  const handleSendEmailCode = async () => {
    if (!schoolEmail.trim()) {
      toast.warning("提示", { description: "请输入学校邮箱" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(schoolEmail)) {
      toast.warning("提示", { description: "请输入有效的邮箱地址" });
      return;
    }

    const eduDomains = [".edu", ".ac.", ".edu."];
    const isEduEmail = eduDomains.some((domain) => schoolEmail.toLowerCase().includes(domain));
    if (!isEduEmail) {
      toast.warning(
        "提示",
        { description: "请使用学校邮箱（通常包含 .edu 或 .ac 等教育机构域名）" }
      );
      return;
    }

    toast.info("提示", { description: "验证码已在提交学生证时发送到您的邮箱，请查收" });
  };

  const handleVerifyEmail = async () => {
    if (!emailCode.trim() || emailCode.length !== 6) {
      toast.warning("提示", { description: "请输入 6 位验证码" });
      return;
    }

    try {
      await verifyEmail.mutateAsync({ code: emailCode });
      setStep("subscription");
      toast.success("验证成功", { description: "邮箱验证成功，请选择您的订阅计划。" });
    } catch (error: any) {
      toast.error("错误", { description: error.message || "验证失败" });
    }
  };

  const handleSelectPlan = async (plan: "6months" | "1year") => {
    setSelectedPlan(plan);
    try {
      await createSubscription.mutateAsync({
        subscriptionType: plan === "6months" ? "halfYear" : "fullYear",
        paymentMethod: "pending",
        paymentId: "pending",
      });

      navigate(`/payment-method?package=student_${plan}&isSubscription=true`);
    } catch (error: any) {
      toast.error("错误", { description: error.message || "创建订阅失败" });
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto pb-10">
        {/* Header */}
        <div className="px-6 pt-8 pb-6">
          <button onClick={() => window.history.back()} className="mb-4 flex items-center text-primary">
            <ArrowLeft className="w-4 h-4 mr-2" />
            <span>返回</span>
          </button>
          <h1 className="text-3xl font-bold text-foreground mb-2">🎓 学生优惠</h1>
          <p className="text-base text-muted">验证学生身份，享受超值订阅优惠</p>
        </div>

        {/* Step Indicator */}
        <div className="mx-6 mb-6 flex items-center justify-between">
            {/* Step 1 */}
            <div className="items-center flex-1 text-center">
                <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${step === "info" ? "bg-primary" : "bg-green-500"}`}>
                    <span className="text-background font-bold">1</span>
                </div>
                <p className="text-xs text-muted mt-2">优惠说明</p>
            </div>
            <div className="h-0.5 bg-border flex-1 mx-2" />
            {/* Step 2 */}
            <div className="items-center flex-1 text-center">
                <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${step === "upload" ? "bg-primary" : (step === "email" || step === "subscription") ? "bg-green-500" : "bg-surface border border-border"}`}>
                    <span className={`font-bold ${(step === "upload" || step === "email" || step === "subscription") ? "text-background" : "text-muted"}`}>2</span>
                </div>
                <p className="text-xs text-muted mt-2">上传学生证</p>
            </div>
            <div className="h-0.5 bg-border flex-1 mx-2" />
            {/* Step 3 */}
            <div className="items-center flex-1 text-center">
                <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${step === "email" ? "bg-primary" : step === "subscription" ? "bg-green-500" : "bg-surface border border-border"}`}>
                    <span className={`font-bold ${step === "email" || step === "subscription" ? "text-background" : "text-muted"}`}>3</span>
                </div>
                <p className="text-xs text-muted mt-2">验证邮箱</p>
            </div>
            <div className="h-0.5 bg-border flex-1 mx-2" />
            {/* Step 4 */}
            <div className="items-center flex-1 text-center">
                <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${step === "subscription" ? "bg-primary" : "bg-surface border border-border"}`}>
                    <span className={`font-bold ${step === "subscription" ? "text-background" : "text-muted"}`}>4</span>
                </div>
                <p className="text-xs text-muted mt-2">选择订阅</p>
            </div>
        </div>

        {/* Step: Info */}
        {step === "info" && (
          <div className="mx-6">
            <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-6 mb-6">
              <h2 className="text-2xl font-bold text-background mb-4">学生专享优惠</h2>
              <div className="space-y-3">
                <div className="flex items-start"><span className="text-background mr-2">✓</span><p className="text-sm text-background flex-1">视频 PK 评分、分镜脚本、虚拟偶像生成等内核功能</p></div>
                <div className="flex items-start"><span className="text-background mr-2">✓</span><p className="text-sm text-background flex-1">免费试用 2 天，无需付款信息</p></div>
                <div className="flex items-start"><span className="text-background mr-2">✓</span><p className="text-sm text-background flex-1">订阅方案：半年 ¥138 或一年 ¥268</p></div>
                <div className="flex items-start"><span className="text-background mr-2">✓</span><p className="text-sm text-background flex-1">优先客服支持</p></div>
              </div>
            </div>
            <div className="space-y-4">
              <button onClick={() => setStep("upload")} className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold">立即认证</button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="w-full bg-secondary text-secondary-foreground py-3 rounded-lg font-semibold">我不是学生，先试用</button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>开始免费试用</AlertDialogTitle>
                    <AlertDialogDescription>您将获得 2 天免费试用，包含视频 PK 评分、2D/3D 偶像生成、720P 视频生成等内核功能。试用期内功能有限，升级订阅可解锁更多。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>再看看</AlertDialogCancel>
                    <AlertDialogAction onClick={handleStartTrial}>立即试用</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* Step: Upload */}
        {step === "upload" && (
          <div className="mx-6">
            <div className="bg-surface rounded-2xl p-6 mb-6 border border-white/10">
              <h3 className="text-xl font-bold mb-4">上传学生证</h3>
              <p className="text-muted mb-6">请上传清晰、有效的学生证照片（包含姓名、学校、有效期）。仅用于审核，我们将严格保密您的信息。</p>
              <div className="w-full h-48 border-2 border-dashed border-border rounded-lg flex items-center justify-center mb-4 relative overflow-hidden">
                {studentIdImage ? (
                  <img src={`data:image/jpeg;base64,${studentIdImage}`} alt="Student ID Preview" className="w-full h-full object-contain" />
                ) : (
                  <div className="text-center text-muted">
                    <p>点击此处上传</p>
                    <p className="text-xs">支持 JPG, PNG</p>
                  </div>
                )}
                <input type="file" accept="image/jpeg,image/png" onChange={handlePickImage} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
              <button onClick={handleSubmitStudentId} disabled={submitVerification.isPending || !studentIdImage} className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold flex items-center justify-center disabled:opacity-50">
                {submitVerification.isPending && <Loader2 className="w-5 h-5 mr-2 animate-spin" />} 
                提交审核
              </button>
            </div>
          </div>
        )}

        {/* Step: Mail */}
        {step === "email" && (
          <div className="mx-6">
            <div className="bg-surface rounded-2xl p-6 mb-6 border border-white/10">
              <h3 className="text-xl font-bold mb-4">验证学校邮箱</h3>
              <p className="text-muted mb-6">我们已向您提交学生证时关联的邮箱发送了验证码，请输入以完成验证。</p>
              <div className="space-y-4">
                <div className="relative">
                  <input type="email" value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} placeholder="请输入学校邮箱" className="w-full bg-input border border-border rounded-lg p-3 pr-28" />
                  <button onClick={handleSendEmailCode} className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-primary font-semibold">发送验证码</button>
                </div>
                <input type="text" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="6 位验证码" maxLength={6} className="w-full bg-input border border-border rounded-lg p-3" />
              </div>
              <button onClick={handleVerifyEmail} disabled={verifyEmail.isPending || !emailCode} className="w-full bg-primary text-primary-foreground py-3 mt-6 rounded-lg font-semibold flex items-center justify-center disabled:opacity-50">
                {verifyEmail.isPending && <Loader2 className="w-5 h-5 mr-2 animate-spin" />} 
                完成验证
              </button>
            </div>
          </div>
        )}

        {/* Step: Subscription */}
        {step === "subscription" && (
          <div className="mx-6">
            <h3 className="text-xl font-bold mb-4">选择订阅方案</h3>
            <div className="space-y-4">
              <div onClick={() => handleSelectPlan("6months")} className={`border-2 rounded-xl p-5 cursor-pointer transition-all ${selectedPlan === "6months" ? "border-primary bg-primary/10" : "border-border"}`}>
                <div className="flex justify-between items-center">
                  <h4 className="text-lg font-semibold">半年订阅</h4>
                  <p className="text-xl font-bold">¥138</p>
                </div>
                <p className="text-sm text-muted">平均 ¥23/月</p>
              </div>
              <div onClick={() => handleSelectPlan("1year")} className={`border-2 rounded-xl p-5 cursor-pointer transition-all ${selectedPlan === "1year" ? "border-primary bg-primary/10" : "border-border"}`}>
                <div className="flex justify-between items-center">
                  <h4 className="text-lg font-semibold">一年订阅</h4>
                  <p className="text-xl font-bold">¥268</p>
                </div>
                <p className="text-sm text-muted">立省 ¥104，平均 ¥22.3/月</p>
              </div>
            </div>
            <p className="text-xs text-muted mt-6 text-center">选择方案后将跳转至支付页面。订阅可随时取消。</p>
          </div>
        )}
      </div>
    </div>
  );
}
