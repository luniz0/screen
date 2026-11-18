# Ekran paylaşımı

Windows uygulaması ana ekranı en fazla 1280 × 720 boyutunda JPEG olarak yakalar ve saniyede 30 kareyi hedefler. Vercel sayfası giriş yaptıktan sonra son kareyi alır. Gerçek kare hızı ağ ve sunucu yanıt süresine bağlıdır. Redis'teki son kareye beş saniyelik süre verilir. Windows'ta paylaşımı durdurduğunda uygulama son kareyi silmeyi dener. Web sayfasındaki **Çıkış yap** düğmesi tarayıcıdaki oturumu kapatır.

## Vercel

1. Proje dizinini Vercel'e aktar. Framework Preset olarak **Other** seç.
2. Bu proje için ayrı bir Upstash Redis veritabanı oluştur. Vercel ortam değişkenlerinde `REDIS_REST_URL` ve `REDIS_REST_TOKEN` değerlerini bu veritabanının REST bağlantısından al.
3. `DEVICE_TOKEN` için en az 32 karakterlik rastgele alfasayısal cihaz anahtarı üret. Sabit hesabın e-postasını `VIEW_EMAIL`, parolasını `VIEW_PASSWORD` olarak ekle ve yeniden dağıt. Giriş bilgileri sunucuda doğrulanır. Redis yalnızca son kareyi tutar.

## Windows

Visual Studio C++ araçları ve Windows SDK kurulu bir makinede:

```powershell
cmake -S windows -B build -A x64
cmake --build build --config Release
```

Windows kullanıcı ortam değişkenlerinde `SCREEN_SHARE_HOST` değerini Vercel alan adı olarak ayarla (örneğin `proje.vercel.app`). `SCREEN_DEVICE_TOKEN` değerini Vercel'deki `DEVICE_TOKEN` ile eşleştir. Uygulamayı yeni bir oturumdan başlat.

- Windows'a girişte uygulamayı açmak için `ScreenShare.exe` kısayolunu `shell:startup` klasörüne koy.
- Uygulamada **Ekranı paylaş** düğmesine bas. Paylaşım sırasında durum penceresi üstte kalır. Oturum kilitlendiğinde paylaşım durur.
- Telefonundan Vercel sitesini açıp sabit e-posta hesabı ve `VIEW_PASSWORD` değeriyle giriş yap. İzleme otomatik başlar. Tarayıcı oturumu bir saat geçerlidir.
