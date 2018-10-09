
var net = require('net');
const Image = require('./index').Image;
const printer = require('./index').Printer;
const client = new net.Socket();
const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcxQrH1z_hzMWQ5HtTBSKslNETR_UxekD0EhaepwveNRTGlozk';


client.connect(9100, '192.168.60.45', () => {


    Image.qr(url, image => {

        console.log('write data');
        let data = printer
                        .align('ct')
                        .raster(image, 'dwdh')
                        .cut()
                        .build();
        client.write(data,()=>{
            client.end();
            client.destroy();
            console.log('end write');
        })

    });

    
})

client.setKeepAlive(true, 20000);