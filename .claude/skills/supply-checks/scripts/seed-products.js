const fs=require('fs'); const d=process.argv[2];
const mk=(id,name,extra)=>({id,name,price:'260',originalPrice:'',category:'Men',desc:'',image:'',images:[],isListed:true,isSoldOut:false,createdAt:Date.now(),updatedAt:Date.now(),history:[],...extra});
const products=[
 // rich variants with per-colour sizes (like the real admin creates), stock numbers per colour
 mk('p-rich','V-NECK UNDERSHIRT Rich',{brand:'Fruit of the Loom',variants:[{color:'White',family:'',image:'',stock:9,sizes:['M','L','XL']},{color:'Black',family:'',image:'',stock:4,sizes:['M','L']}],sizes:['M','L','XL'],stock:13,variantStock:{White:9,Black:4}}),
 // plain string variants, product-level sizes
 mk('p-plain','Round neck plain',{variants:['white','grey'],sizes:['S','M','L'],stock:null}),
 // one-size product, no variants, no sizes (socks)
 mk('p-socks','Charnos Socks',{variants:[],sizes:[],stock:20}),
 // numeric UK sizes for panties
 mk('p-panty','George Panties Lace',{category:'Women',variants:[{color:'Black',family:'',image:'',stock:6,sizes:['6','8','10','12']}],sizes:['6','8','10','12'],stock:6}),
 // hostile names
 mk('p-evil','Boxer <img src=x onerror=window.__xss=1> "Q\' & Jockey',{variants:[{color:'Red "Hot" <b>',family:'',image:'',stock:3,sizes:['S','M']}],sizes:['S','M'],stock:3}),
 // colour name that contains the key delimiter
 mk('p-pipe','Pipe|Product',{variants:['a|b'],sizes:['M'],stock:5}),
];
fs.writeFileSync(d+'/products.json',JSON.stringify(products,null,2));
for (const f of ['orders','customers','reviews']) fs.writeFileSync(d+'/'+f+'.json','[]');
console.log('seeded',products.length);
