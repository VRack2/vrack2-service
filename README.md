## **VRack2-Service**  

Репозиторий для запуска сервисов на основе **VRack2-Core**, включая официальный **VRack2**.  

Позволяет:  
- Развернуть готовый VRack2 (см. [официальный гайд](https://github.com/VRack2/vrack2)).  
- Запускать **собственные сервисы** без зависимостей от VRack2.  

---

## **1. Быстрый старт**  

### Запуск VRack2  

Следуйте [инструкции по установке VRack2](https://github.com/VRack2/vrack2).  

### Запуск своего сервиса  
1. Склонируйте репозиторий:  
   ```bash
   git clone https://github.com/VRack2/vrack2-service.git /opt/vrack2-service
   cd /opt/vrack2-service
   ```

2. Установите зависимости:
   ```bash
   npm install
   ```

3. Создайте структуру директорий:  
   ```bash
   mkdir -p devices storage structure
   ```

4. Поместите свой сервис в `./devices/`:  
   ```bash
   cd devices
   git clone <ваш-репозиторий-с-сервисом>  # Или вручную скопируйте файлы
   ```

5. Запустите сервис:  
   ```bash
   cd ..
   npm run start "./devices/ваш_сервис/service.json"
   ```

---

## **2. Детали конфигурации**  

### Структура проекта  
- `./devices/` — директория для сервисов и наборов устройств (например, `vrack2`, `your-custom-service`)
- `./storage/` — хранилище данных устройств
- `./structure/` — хранилище структур сервисов

---

## **3. Пример: Запуск VRack2**  
Если вы используете официальный VRack2:  
```bash
cd devices
git clone https://github.com/VRack2-Devices/vrack2
cd ..
npm run start "./devices/vrack2/vrack2.json"
```

### **Где искать документацию?**  

- **VRack2**: Расширеная документация  → [VRack2](https://github.com/VRack2/vrack2).
- **VRack2-Core**: Набор базовых компонентов → [документация ядра](http://github.com/VRack2/).  
