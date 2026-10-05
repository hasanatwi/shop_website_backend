import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import specificProducts from "./specificProducts.js";
import { createClient } from "@supabase/supabase-js";
import itemRouter from "./Item.js";
import userProductsRouter from "./userProducts.js";

dotenv.config();

const app = express();
const saltRounds = 10;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const frontendOrigin = process.env.FRONTEND_URL.replace(/\/$/, "");

const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (origin === frontendOrigin) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(passport.initialize());
app.use(passport.session());

passport.use(//tells passport: I am defining a new login method
    new Strategy(//this creates a local strategy=> login using username and password
      {usernameField: "signInEmail", passwordField: "signInPassword"}, //username comes from req.body.username and password comes from req.body.password
      async(signInEmail, signInPassword, cb)=>{
        try{
        const {data: users, error}=await supabase.from("users").select("*").eq("email",signInEmail);
        if(error)
          return cb(error)
        if(!users || users.length===0)
          return cb(null, false);
        const user=users[0];
        bcrypt.compare(signInPassword, user.password, (err,valid)=>{
          if(err)
            return cb(err);
          return cb(null, valid? user : false);
        });
      }
      catch(err){
        return cb(err);
      }
      }
    )
);

passport.serializeUser((user, cb)=>cb(null, user));
passport.deserializeUser((user, cb)=>cb(null,user));

app.post("/login",(req,res,next)=>{
  console.log("The app.post(login) was entered");
  passport.authenticate("local",(err, user)=>{
    if(err){
      console.log("An error has occured: "+err);
      return res.status(500).json({message: "Server Error"});
    }
    if(!user){
      console.log("The credentials are invalid");
      return res.status(401).json({message: "Invalid Credentials"});
    }
    req.login(user, (err)=>{
        if(err)
          return res.status(500).json({message: "Login failed"});
        res.status(200).json({message: "Login successful", user});
    });
  })(req,res,next);
});

app.delete("/deleteItemImageOption", async (req, res) => {
  console.log("The /deleteItemImageOption was entered");
  const { itemComponentID, imageIndex, smallProperty, correspondingOption } = req.body;

  // Validate input
  if (!itemComponentID || imageIndex === undefined || imageIndex === null) {
    return res.status(400).json({ message: "itemComponentID and imageIndex are required" });
  }

  const prop = typeof smallProperty === "string" ? smallProperty.trim() : "";
  const option =
    correspondingOption === undefined || correspondingOption === null
      ? ""
      : String(correspondingOption).trim(); // "" means: delete the whole property

  if (!prop) {
    return res.status(400).json({ message: "smallProperty is required" });
  }

  const index = parseInt(imageIndex, 10);
  if (Number.isNaN(index) || index < 0) {
    return res.status(400).json({ message: "Invalid image index" });
  }

  try {
    // 1. Fetch the current images array
    const { data: itemRow, error: fetchError } = await supabase
      .from("item")
      .select("images")
      .eq("component_id", itemComponentID)
      .single();

    if (fetchError) {
      console.log("Error fetching item row:", fetchError);
      return res.status(500).json({ message: "Failed to fetch item" });
    }

    // Normalize (same as /getItemImages, so the index matches what the frontend sees)
    const images = (itemRow.images || [])
      .map((item) => {
        if (typeof item === "string") {
          try {
            return JSON.parse(item);
          } catch (err) {
            console.log("Failed to parse image entry:", item, err);
            return null;
          }
        }
        return item;
      })
      .filter(Boolean);

    if (index >= images.length) {
      return res.status(404).json({ message: "Image not found" });
    }

    const imageObj = images[index];

    if (!Array.isArray(imageObj.smallProperty)) imageObj.smallProperty = [];
    if (!Array.isArray(imageObj.correspondingOption)) imageObj.correspondingOption = [];

    // Normalize old data: a flat string entry becomes an array of one option
    imageObj.correspondingOption = imageObj.correspondingOption.map((o) =>
      Array.isArray(o) ? o : [o]
    );

    // 2. Find the property (case-insensitive)
    const propIndex = imageObj.smallProperty.findIndex(
      (p) => String(p).toLowerCase() === prop.toLowerCase()
    );

    if (propIndex === -1) {
      return res.status(404).json({ message: "The property was not found on this image" });
    }

    if (option === "") {
      // CASE 1: no option given -> delete the whole property and its options array
      imageObj.smallProperty.splice(propIndex, 1);
      imageObj.correspondingOption.splice(propIndex, 1);
    } else {
      // CASE 2: option given -> delete just that option
      const opts = imageObj.correspondingOption[propIndex] || [];

      const optIndex = opts.findIndex(
        (o) => String(o).toLowerCase() === option.toLowerCase()
      );

      if (optIndex === -1) {
        return res.status(404).json({ message: "The option was not found for this property" });
      }

      opts.splice(optIndex, 1);

      if (opts.length === 0) {
        // It was the last option -> delete the property and its options array too
        imageObj.smallProperty.splice(propIndex, 1);
        imageObj.correspondingOption.splice(propIndex, 1);
      } else {
        imageObj.correspondingOption[propIndex] = opts;
      }
    }
    console.log("The imageObj becomes: ");
    console.log(imageObj);
    images[index] = imageObj;

    // 3. Save back to the database
    const { error: updateError } = await supabase
      .from("item")
      .update({ images: images })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating item images:", updateError);
      return res.status(500).json({ message: "Failed to update image" });
    }
    console.log("The option or the property was deleted successfully");
    return res.status(200).json({
      message: "Deleted successfully",
      images: images,
    });
  } catch (err) {
    console.log("Error in /deleteItemImageOption:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.delete("/deleteItemImage", async (req, res) => {
  console.log("The /deleteItemImage was entered");
  const { itemComponentID, imageIndex } = req.body;

  console.log("The itemComponentID is: " + itemComponentID);
  console.log("The imageIndex is: " + imageIndex);

  if (!itemComponentID || imageIndex === undefined || imageIndex === null) {
    return res.status(400).json({ message: "itemComponentID and imageIndex are required" });
  }

  const index = parseInt(imageIndex, 10);

  if (Number.isNaN(index) || index < 0) {
    return res.status(400).json({ message: "Invalid image index" });
  }

  try {
    // 1. Fetch the current images array for this item
    const { data: itemRow, error: fetchError } = await supabase
      .from("item")
      .select("images")
      .eq("component_id", itemComponentID)
      .single();

    console.log("the old images array is: ");
    console.log(itemRow);

    if (fetchError) {
      console.log("Error fetching item row:", fetchError);
      return res.status(500).json({ message: "Failed to fetch item" });
    }

    // Normalize, same as /getItemImages does (legacy rows may be stringified JSON)
    const currentImages = (itemRow.images || []).map((item) => {
      if (typeof item === "string") {
        try {
          return JSON.parse(item);
        } catch (err) {
          console.log("Failed to parse existing image entry:", item, err);
          return null;
        }
      }
      return item;
    }).filter(Boolean);

    if (index >= currentImages.length) {
      return res.status(400).json({ message: "Image index out of range" });
    }

    // 2. Remove the element at the given index
    const updatedImages = currentImages.filter((_, i) => i !== index);

    // 3. Save the updated array back to the row
    const { error: updateError } = await supabase
      .from("item")
      .update({ images: updatedImages })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating item images:", updateError);
      return res.status(500).json({ message: "Failed to delete image" });
    }

    res.status(200).json({ message: "The image was deleted successfully", images: updatedImages });

  } catch (err) {
    console.log("An error has occurred:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/addItemImage", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    const { itemComponentID } = req.body;

    console.log("File info:", {
      size: file.buffer?.length,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });

    if (!file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    if (!itemComponentID) {
      return res.status(400).json({ message: "No itemComponentID provided" });
    }

    const filePath = `${Date.now()}_${file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from("backgrounds")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.log("Error uploading to Supabase:", uploadError);
      return res.status(500).json({ message: "Failed to upload image" });
    }

    const { data: publicUrlData } = supabase.storage
      .from("backgrounds")
      .getPublicUrl(filePath);

    // Combine the 3 pieces of data into a single array element
    const newImageEntry = {
        url: publicUrlData.publicUrl,
        smallProperty: [],
        correspondingOption: [],
      };
    console.log("newImageEntry: ");
    console.log(newImageEntry);
    // Get the current images array for this item
    const { data: itemRow, error: fetchError } = await supabase
      .from("item")
      .select("images")
      .eq("component_id", itemComponentID)
      .single();


      

    if (fetchError) {
      console.log("Error fetching item row:", fetchError);
      return res.status(500).json({ message: "Failed to fetch item" });
    }

    const existingImages = (itemRow.images || []).map((item) => {
        if (typeof item === "string") {
          try {
            return JSON.parse(item);
          } catch (err) {
            console.log("Failed to parse existing image entry:", item, err);
            return null;
          }
        }
        return item;
      }).filter(Boolean);

    const updatedImages = [...existingImages, newImageEntry];

    const { error: updateError } = await supabase
      .from("item")
      .update({ images: updatedImages })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating item images:", updateError);
      return res.status(500).json({ message: "Failed to update item images" });
    }

    return res.status(200).json({
      message: "Image uploaded and item updated successfully",
      imageEntry: newImageEntry,
      images: updatedImages,
    });
  } catch (err) {
    console.log("Error in /addItemImage:", err);
    return res.status(500).json({ message: "Server error while uploading image" });
  }
});

app.patch("/updateItemDescription", async (req, res) => {
  console.log("The /updateItemDescription was entered");
  const { itemComponentID, description } = req.body;

  if (!itemComponentID) {
    return res.status(400).json({ message: "itemComponentID is required" });
  }

  const desc = typeof description === "string" ? description : "";

  try {
    const { error } = await supabase
      .from("item")
      .update({ description: desc })
      .eq("component_id", itemComponentID);

    if (error) {
      console.log("Error updating item description:", error);
      return res.status(500).json({ message: "Failed to update description" });
    }

    return res.status(200).json({
      message: "Description updated successfully",
      description: desc,
    });
  } catch (err) {
    console.log("Error in /updateItemDescription:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

  app.get("/getItemDescription", async (req, res) => {
  console.log("The /getItemDescription was entered");
  const { component_id } = req.query;

  if (!component_id) {
    return res.status(400).json({ message: "component_id is required" });
  }

  try {
    const { data: itemRow, error } = await supabase
      .from("item")
      .select("description")
      .eq("component_id", component_id)
      .single();

    if (error) {
      console.log("Error fetching item description:", error);
      return res.status(500).json({ message: "Failed to fetch description" });
    }

    return res.status(200).json({
      message: "Description fetched successfully",
      description: itemRow?.description || "",
    });
  } catch (err) {
    console.log("Error in /getItemDescription:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


app.post("/storeComponent",async(req,res)=>{
  console.log("The storeComponent was entered");
  const {latestComponentID, specs, page_id, buttonFunctionality, pageToNavigateTo, div_id}=req.body;//The specs are retrieved from the frontend successfully
  console.log("The specs are: ");
  console.log(specs);
  console.log("The page_id is: ");
  console.log(page_id);
  console.log("The buttonFunctionality is: ");
  console.log(buttonFunctionality);
  console.log("The pageToNavigateTo is: ");
  console.log(pageToNavigateTo);
  console.log("The div_id is: ");
  console.log(div_id);
  
  const { error: error2 } = await supabase
  .from("variables")
  .update({ value: Number(latestComponentID) + 1 })
  .eq("variablename", "highestComponentID");

  if (error2) {
    console.log("Error updating the value of the latestComponentID:", error2);
  } else {
    console.log("The latestComponentID was updated successfully");
  }

  const {data: newComponent, error}=await supabase.from("component").insert([{specs:specs, page_id:page_id, buttonFunctionality: buttonFunctionality, pageToNavigateTo: pageToNavigateTo, div_id: div_id}]);
  if(error){
    console.log("Error inserting data to the database", error);
    return res.status(500).json({message: "Error inserting the new component to the database"});
  }
res.status(200).json({message: "Inserting the new component to database was successful", component: newComponent});
});

app.patch("/updateItemImageProperty", async (req, res) => {
  const {
    itemComponentID,
    imageIndex,
    smallProperty,
    correspondingOption
  } = req.body;

  try {
    // Validate input
    if (imageIndex === undefined || imageIndex === null) {
      return res.status(400).json({ message: "imageIndex is required" });
    }

    const prop = typeof smallProperty === "string" ? smallProperty.trim() : "";
    const option = typeof correspondingOption === "string" ? correspondingOption.trim() : "";

    if (!prop || !option) {
      return res.status(400).json({
        message: "smallProperty and correspondingOption are required"
      });
    }

    // Get the item and its images
    const { data: itemRow, error: fetchError } = await supabase
      .from("item")
      .select("images")
      .eq("component_id", itemComponentID)
      .single();

    if (fetchError) {
      console.log("Error fetching item:", fetchError);
      return res.status(500).json({ message: "Failed to fetch item" });
    }

    const imagesArray = itemRow.images || [];
    const index = parseInt(imageIndex, 10);

    // Check that the image exists
    if (Number.isNaN(index) || index < 0 || index >= imagesArray.length) {
      return res.status(404).json({ message: "Image not found" });
    }

    // Get the selected image (your DB may store it as a JSON string)
    const wasString = typeof imagesArray[index] === "string";
    const imageObj = wasString
      ? JSON.parse(imagesArray[index])
      : imagesArray[index];

    // Make sure the arrays exist
    if (!Array.isArray(imageObj.smallProperty)) {
      imageObj.smallProperty = [];
    }
    if (!Array.isArray(imageObj.correspondingOption)) {
      imageObj.correspondingOption = [];
    }

    // Normalize old data: a flat string entry becomes an array of one option
    imageObj.correspondingOption = imageObj.correspondingOption.map((o) =>
      Array.isArray(o) ? o : [o]
    );

    // Does this property already exist? (case-insensitive)
    const propIndex = imageObj.smallProperty.findIndex(
      (p) => p.toLowerCase() === prop.toLowerCase()
    );

    if (propIndex !== -1) {
      // Property exists: add the option at the same index
      const opts = imageObj.correspondingOption[propIndex] || [];

      const alreadyExists = opts.some(
        (o) => o.toLowerCase() === option.toLowerCase()
      );

      if (alreadyExists) {
        return res.status(409).json({
          message: "This option already exists for this property"
        });
      }

      opts.push(option);
      imageObj.correspondingOption[propIndex] = opts;
    } else {
      // New property: add it with its first option
      imageObj.smallProperty.push(prop);
      imageObj.correspondingOption.push([option]);
    }

    // Put the modified image back into the array, in the same format it came in
    imagesArray[index] = imageObj;

    // Update the database
    const { error: updateError } = await supabase
      .from("item")
      .update({ images: imagesArray })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating item images:", updateError);
      return res.status(500).json({ message: "Failed to update image" });
    }

    return res.status(200).json({
      message: "Updated successfully",
      images: imagesArray
    });
  } catch (err) {
    console.log("Error in /updateItemImageProperty:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

  app.post("/getComponents", async(req,res)=>{
  const {page_id}=req.body;
  const {data: components, error}=await supabase.from("component").select("*").eq("page_id",page_id);
  if(error)
    return res.status(500).json({message: "Error retrieving data from the database"});
  res.status(200).json({message: "Data was retrieved successfully from the database", components: components}); 
});

app.get("/checkComponentID",async(req,res)=>{
  const {componentID}=req.query;
  const {data: components, error}= await supabase.from("item").select("*").eq("component_id",componentID);
  if(error)
    return res.status(500).json({message: "There was an error retrieving the components"});
  res.status(200).json({components: components, message: "The components were retrieved successfully"});
});

app.post("/createItem", async(req,res)=>{
  console.log("the /createItem was entered");
  const {componentID}=req.body;
  const {error}= await supabase.from("item").insert({component_id: componentID});
  if(error){
    console.log("An error occured while creating the new item: ");
    console.log(error);
    return res.status(500).json({message: "An error occurred when inserting the Item in the database"});
  }
  res.status(200).json({message: "The item was inserted in the table successfully"});
});

// GET /api/properties/:itemComponentID
app.get("/setProperties/:typeWeAreDealingWith/:itemComponentID", async (req, res) => {
  console.log("app.get('api/properties/:typeWeAreDealingWith/:itemComponentID' has started");
  const { typeWeAreDealingWith, itemComponentID } = req.params;

  try {
    console.log("The typeWeAreDealingWith is: "+typeWeAreDealingWith);
    // Step 1: Go to "itemType" table, get properties using itemType_id
    const { data: itemTypeData, error: itemTypeError } = await supabase
      .from('itemType')
      .select('properties')
      .eq('itemTypeName', typeWeAreDealingWith)
      .single();

    if (itemTypeError) throw itemTypeError;
    console.log("The properties that we got: ");
    console.log(itemTypeData.properties);

    const { error: updateError } = await supabase
      .from('item')
      .update({ properties: itemTypeData.properties })
      .eq('component_id', itemComponentID);

    if (updateError) throw updateError;
    console.log("The item's properties were updated successfully");
    res.status(200).json({ properties: itemTypeData.properties });

  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

app.post("/setTypeID", async (req, res) => {
  const { typeName, itemComponentID } = req.body;

  // 1. Look up the itemType_id for this typeName
  const { data: itemType, error: fetchError } = await supabase
    .from("itemType")
    .select("itemType_id")
    .eq("itemTypeName", typeName)
    .single();

  if (fetchError) {
    console.error("Error fetching itemType:", fetchError);
    return res.status(500).json({ message: "Error fetching itemType" });
  }

  const itemType_id = itemType.itemType_id;
  console.log("Resolved itemType_id: " + itemType_id);

  // 2. Assign that itemType_id to every item currently missing one
  const { error: updateError } = await supabase
    .from("item")
    .update({ "itemType_id": itemType_id })
    .eq("component_id", itemComponentID);

  if (updateError) {
    console.error("Error updating item itemType_id:", updateError);
    return res.status(500).json({ message: "Error updating item itemType_id" });
  }


  res.status(200).json({
    message: "itemType_id assigned successfully",
  });
});

app.get("/getLatestComponentID", async (req, res) => {
  console.log("The /getLatestComponentID was entered");
  try{
    const {data: latestComponentID, error}=await supabase.from("variables").select("value").eq("variablename","highestComponentID").single();
    if(error){
      console.log("There was an error retrieving the highestComponentID form the database");
      return res.status(500).json({message: "There was an error retrieving the highestComponentID form the database"});
    }else{
      console.log("The latestComponentID is:");
      console.log(latestComponentID);
      res.status(200).json({message: "The highestComponentID was retrieved", latestComponentID: latestComponentID.value})
    }
  }
  catch(err){
    console.log("there is an error", err);
  }
}); 

app.get("/getInnerComponents", async (req, res) => {
  console.log("The /getInnerComponents was entered");
  const { component_id } = req.query;
  console.log("The component_id: "+component_id);
  if (!component_id) {
    return res.status(400).json({ error: "component_id is required" });
  }

  try {
    const { data: innerComponents, error } = await supabase
      .from("component")
      .select("*")
      .eq("div_id", component_id);

    if (error) {
      console.error("Error fetching inner components:", error);
      return res.status(500).json({ error: "Internal server error" });
    }

    return res.status(200).json(innerComponents);
  } catch (err) {
    console.error("Error fetching inner components:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/getGlobalZIndex",async(req,res)=>{
  console.log("*************************************************"); 
  console.log("The /getGlobalZIndex was entered");
  const {data: globalZIndex, error}= await supabase.from("variables").select("value").eq("variablename","globalZIndex").single();
  console.log("*************************************************"); 
  console.log("I am in the backend part the globalZIndex is: "+globalZIndex.value);//why is this printing [object Object]
  if(error){
    console.log("An Error occured: "+error);
    return res.status(500).json({message: "An error occured when retrieving the globalZIndex"});
  }
  res.status(200).json({globalZIndex: globalZIndex.value, message: "The globalZIndex was retrieved from the database"});
});

app.delete("/deleteComponent",async(req,res)=>{
  const {component_id}=req.body;
  const {error}=await supabase.from("component").delete().eq("component_id",component_id);
  if(error){
    console.log("Error deleting the component: ",error);
    return res.status(500).json({message: "Error deleting the component"});
  }
  console.log("The component was deleted");
  res.status(200).json({message: "The component was deleted"});
});



app.post("/addItemType", async(req,res)=>{
  const {itemType}=req.body;
  const {data: existingItemType, error2}=await supabase.from("itemType").select("*").eq("itemTypeName",itemType);
  if(existingItemType.length>0)
    return res.status(400).json({message: "The item type already exists"});
  if(error2){
    console.log("An error has occured while checking if the type already existed: "+error2);
    return res.status(500).json({message: "An error has occured while checking if the type already existed"});
  }
  const {error}= await supabase.from("itemType").insert([{itemTypeName: itemType}]);
  if(error){
    console.log("An error has occured when adding the new type, "+error);
    return res.status(500).json({message: "An error occured while adding the new type"});
  }
  res.status(200).json({message: "An item type was added successfully"});
});

app.get("/getItemTypes", async(req,res)=>{
  console.log("The /getItemTypes was entered");
  try{
    const {data: itemTypeNames, error}=await supabase.from("itemType").select("itemTypeName");
    if(error){
      console.log("An error has occured: ",error);
      return res.status(500).json({message: "An error has occured"});
    }
    console.log("the itemTypeNames are: ");
    console.log(itemTypeNames);
    res.status(200).json({itemTypeNames: itemTypeNames, message: "The item type names were retrieved successfully"});
  }
  catch(err){
    console.log("An error has occured: ",err);
  }
});

app.post("/addProperty", async (req, res) => {
  const { propertyName, propertyType, typeWeAreDealingWith, unitOfMeasurement} = req.body;
  console.log("The type we are dealing with is: " + typeWeAreDealingWith);
  const newProperty = { property: propertyName, datatype: propertyType, options: [], unitOfMeasurement: unitOfMeasurement};

  const { data: existing, error: fetchError } = await supabase
    .from("itemType")
    .select("properties, itemType_id")
    .eq("itemTypeName", typeWeAreDealingWith)
    .single();

  if (fetchError) {
    console.error("Error fetching existing properties:", fetchError);
    return res.status(500).json({ message: "Error fetching existing properties" });
  }

  const itemType_id= existing.itemType_id;
  console.log("the itemType_id is: "+itemType_id);
  const currentProperties = existing.properties || [];
  const updatedProperties = [...currentProperties, newProperty];

  const { error: updateError } = await supabase
    .from("itemType")
    .update({ properties: updatedProperties })
    .eq("itemTypeName", typeWeAreDealingWith);

  if (updateError) {
    console.error("Error updating properties:", updateError);
    return res.status(500).json({ message: "Error updating properties" });
  }

  const { data: items, error: fetchError2 } = await supabase
  .from("item")
  .select("item_id, properties")
  .eq("itemType_id", itemType_id);

  if (fetchError2) {
    console.error("Error fetching items:", fetchError2);
    return res.status(500).json({ message: "Error fetching items" });
  }

  const updates = items.map((item) => {
    const currentProperties2 = item.properties || [];
    const updatedProperties2 = [...currentProperties2, newProperty];
    return supabase
      .from("item")
      .update({ properties: updatedProperties2 })
      .eq("item_id", item.item_id);
  });

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error("Error updating item properties:", failed.error);
    return res.status(500).json({  message: "Error updating item properties" });
  }

  res.status(200).json({ newProperty: newProperty, message: "Property added successfully" });
});

app.post("/addPage", async(req, res)=>{
const {newPageName}=req.body;
try{
const {data: newPage, error}=await supabase.from("page").insert([{name: newPageName}]);
      if(error){
        return res.status(500).json({message: "Error inserting the new page to the database"});
      }
      res.status(200).json({message: "The new page was inserted to the database successfully"});
    }
    catch(err){
      console.log("An error has occured, "+err);
    }
});

app.post("/updateGlobalZIndex", async(req,res)=>{
  console.log("The /updateGlobalZIndex was entered");
  const {newZIndex}=req.body;
  console.log("newZIndex to update in the DB: "+newZIndex);
  const {error}=await supabase.from("variables").update({value: newZIndex}).eq("variablename", "globalZIndex");
  if(error){
    console.log("An error has occured: "+error);
    return res.status(500).json({ message: "Failed to update globalZIndex" });
  }
  res.status(200).json({ message: "globalZIndex updated" });
});

app.post("/updateImageURL", upload.single("imageFile"), async(req,res)=>{
  try{
    if(!req.file){
      console.log("No image file was provided");
      return res.status(400).json({message: "No image file was provided"});
    }
    console.log("The image file was provided");
    const fileExt= req.file.originalname.split(".").pop();
    const fileName= `component-${Date.now()}.${fileExt}`;
    const {error: uploadError}= supabase.storage.from("backgrounds").upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });
    if(uploadError){
      return res.status(500).json({message: "Error uploading image to storage"});
    }
    const {data: publicUrlData }=supabase.storage.from("backgrounds").getPublicUrl(fileName);
    console.log("The online url is: ");
    console.log(publicUrlData);
    if(publicUrlData)
      res.status(200).json({imageUrl: publicUrlData, message: "The url was sent successfully"});
    }
  catch(err){
    console.log("There is an error, ",err);
  }
});

app.get("/getPages", async(req, res)=>{
  const {data: pages, error}=await supabase.from("page").select("*");
  if(error){
    return res.status(500).json({message: "Error retrieving the pages from the database"});
  }
  res.status(200).json({message: "The pages were retrieved from the database successfully", data: pages});
});

app.get("/getProperties", async (req, res) => {
  try {
    const { component_id } = req.query;

    const { data, error } = await supabase
      .from("item")
      .select("properties")
      .eq("component_id", component_id)
      .single();

    if (error) {
      console.error("Error getting properties:", error);

      return res.status(500).json({
        message: "Error getting properties"
      });
    }

    return res.status(200).json({
      properties: data.properties
    });

  } catch (err) {
    console.error("Server error:", err);

    return res.status(500).json({
      message: "Server error"
    });
  }
});

app.post("/updateComponent", async(req,res)=>{
  console.log("the /updateComponents was entered");
  const {newSpecs, page_id, component_id, buttonFunctionality, pageToNavigateTo}=req.body;
  console.log("newSpecs:", newSpecs);
  console.log("page_id:", page_id);
  console.log("component_id:", component_id);
  console.log("buttonFunctionality:", buttonFunctionality);
  console.log("pageToNavigateTo:", pageToNavigateTo);
  
  console.log(`the page_id: ${page_id}`);
  const {error}=await supabase.from("component").update({specs: newSpecs, buttonFunctionality: buttonFunctionality, pageToNavigateTo: pageToNavigateTo}).eq("component_id", component_id);
  if(error){
    return res.status(500).json({message: "An error has occured"});
  }
  else{
    res.status(200).json({message: "The data in the database was updated successfully"});
  }
});
app.get("/logout",(req,res,next)=>{
    req.logout((err)=>{//calls the passport's logout function in order to remove the user from the session
      if(err)
        return res.status(500).json({ message: "Logout failed" });
      res.clearCookie("connect.sid");
      res.status(200).json({message: "Logged out"});
});
});

app.post("/updateTypeWeAreDealingWith", async (req, res) => {
  const { itemComponentID } = req.body;

  if (!itemComponentID) {
    return res.status(400).json({ message: "itemComponentID is required" });
  }

  // 1. Get itemType_id from item, using component_id
  const { data: item, error: itemError } = await supabase
    .from("item")
    .select("itemType_id")
    .eq("component_id", itemComponentID)
    .single();

  if (itemError) {
    console.error("Error fetching item:", itemError);
    return res.status(500).json({ message: "Error fetching item" });
  }

  const itemType_id = item.itemType_id;
  console.log("Resolved itemType_id: " + itemType_id);

  // 2. Get itemTypeName from itemType, using itemType_id
  const { data: itemType, error: itemTypeError } = await supabase
    .from("itemType") 
    .select("itemTypeName")
    .eq("itemType_id", itemType_id)
    .single();

  if (itemTypeError) {
    console.error("Error fetching itemType:", itemTypeError);
    return res.status(500).json({ message: "Error fetching itemType" });
  }

  res.status(200).json({
    itemType_id,
    itemTypeName: itemType.itemTypeName,
  });
});

app.post("/signUp", async(req,res)=>{
    console.log("The /signUp was entered");
    const {username: email, password, nameOfTheUser}=req.body;
    try{
        const {data: users}=await supabase.from("users").select("*").eq("email", email);
        if(users.length>=1)
          return res.status(400).json({message: "User already exists"});
        const hashedPassword= await bcrypt.hash(password, saltRounds);
        const {data: newUser, error}=await supabase.from("users").insert([{email, password: hashedPassword, nameoftheuser: nameOfTheUser},]).select().single();
        if(error)
          return res.status(500).json({message: "Error inserting the new user"});
        req.login(newUser, (err)=>{
          if(err)
            return res.status(500).json({message: "Error logging in"});
          res.status(200).json({message: "Login successful", user: newUser});
        });
    }
    catch(err){
      console.log("An error has occured: ",err);
    }
});

app.post("/updateIsTheLowest", async (req, res) => {
  console.log("The /updateIsTheLowest was entered");
  const { component_id, isTheLowest } = req.body;

  if (component_id === undefined || component_id === null || typeof isTheLowest !== "boolean") {
    return res.status(400).json({ message: "component_id and a boolean isTheLowest are required" });
  }

  try {
    const { error } = await supabase
      .from("component")
      .update({ isTheLowest: isTheLowest })
      .eq("component_id", component_id);

    if (error) {
      console.log("Error updating isTheLowest:", error);
      return res.status(500).json({ message: "Failed to update isTheLowest" });
    }

    res.status(200).json({ message: "isTheLowest updated successfully", isTheLowest });
  } catch (err) {
    console.log("Error in /updateIsTheLowest:", err);
    res.status(500).json({ message: "Server error" });
  }
});


app.post("/updateBackground", async(req, res)=>{
  console.log("The app.post updateBackground was entered");
  const {backgroundColor, backgroundImage, backgroundIsImage, page_id}=req.body;
  console.log("The new selected background color is: "+backgroundColor);
  const {error}=await supabase.from("page").update({backgroundIsImage:backgroundIsImage,backgroundColor:backgroundColor,backgroundImage: backgroundImage}).eq("page_id",page_id);
  if(error){
    res.status(500).json({message: "Error updating the background in the database"});
  }
  res.status(200).json({message: "The background in the database was updated successfully"});
});
app.post("/updateBackgroundImage", upload.single("backgroundImage"), async (req, res) => {
  try {
const { page_id } = req.body;
    if (!req.file) {
return res.status(400).json({ message: "No image file was provided" });
    }

    // Upload the actual file bytes to Supabase Storage
    const fileExt = req.file.originalname.split(".").pop();
    const fileName = `page-${page_id}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("backgrounds")
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
return res.status(500).json({ message: "Error uploading image to storage" });
    }

    const { data: publicUrlData } = supabase.storage
      .from("backgrounds")
      .getPublicUrl(fileName);
const { error } = await supabase
      .from("page")
      .update({
        backgroundIsImage: true,
        backgroundImage: publicUrlData.publicUrl,//does this save in the supabase the same as the publicUrlData.publicUrl t t I printed before?
      })
      .eq("page_id", page_id);

    if (error) {
return res.status(500).json({ message: "Error updating the background in the database" });
    }

    res.status(200).json({ message: "The background in the database was updated successfully" });
  } catch (err) {
res.status(500).json({ message: "Server error" });
  }
});
app.get("/getBackground",async(req,res)=>{
const {page_id}=req.query;
    const {data: background, error}=await supabase.from("page").select("backgroundIsImage, backgroundColor, backgroundImage").eq("page_id", page_id);

    if(error)
      return res.status(500).json({message: "Error retrieving the background color from the database"});
    res.status(200).json({background, message: "The background was retrieved successfully"});
});

app.get("/getItemImages", async (req, res) => {
  try {
    const { component_id } = req.query;

    if (!component_id) {
      return res.status(400).json({ message: "No component_id provided" });
    }

    const { data: itemRow, error } = await supabase
      .from("item")
      .select("images")
      .eq("component_id", component_id)
      .single();

    if (error) {
      console.log("Error fetching item images:", error);
      return res.status(500).json({ message: "Failed to fetch images" });
    }

    const rawImages = itemRow?.images || [];

    // Normalize: some rows may be stringified JSON (legacy), some may already be objects
    const parsedImages = rawImages.map((item) => {
      if (typeof item === "string") {
        try {
          return JSON.parse(item);
        } catch (err) {
          console.log("Failed to parse image entry:", item, err);
          return null;
        }
      }
      return item;
    }).filter(Boolean);

    return res.status(200).json({
      message: "Images fetched successfully",
      images: parsedImages,
    });
  } catch (err) {
    console.log("Error in /getItemImages:", err);
    return res.status(500).json({ message: "Server error while fetching images" });
  }
});


app.post("/addOption", async (req, res) => {
  console.log("The /addOption was entered");
  const { itemComponentID, propertyName, newOption } = req.body;

  console.log("The itemComponentID is: " + itemComponentID);
  console.log("The propertyName is: " + propertyName);
  console.log("The newOption is: " + newOption);

  if (!itemComponentID || !propertyName || newOption === undefined || newOption === "") {
    return res.status(400).json({ message: "itemComponentID, propertyName and newOption are required" });
  }

  try {
    // 1. Fetch the item's properties using component_id
    const { data: item, error: fetchError } = await supabase
      .from("item")
      .select("properties")
      .eq("component_id", itemComponentID)
      .single();

    if (fetchError) {
      console.log("Error fetching the item's properties:", fetchError);
      return res.status(500).json({ message: "Error fetching the item's properties" });
    }

    const properties = item.properties || [];

    // 2. Find the target property
    const propertyIndex = properties.findIndex(
      (prop) => prop.property.toLowerCase() === propertyName.toLowerCase()
    );

    if (propertyIndex === -1) {
      console.log("The property was not found: " + propertyName);
      return res.status(404).json({ message: "The property was not found" });
    }

    const targetProperty = properties[propertyIndex];

    // 3. Check if the option already exists
    const optionExists = targetProperty.options.some(
      (opt) => String(opt).toLowerCase() === String(newOption).toLowerCase()
    );

    if (optionExists) {
      console.log("The option already exists for this property");
      return res.status(400).json({ message: "The option already exists for this property" });
    }

    // 4. Add the new option
    targetProperty.options.push(newOption);
    properties[propertyIndex] = targetProperty;

    // 5. Update the item's properties in the database
    const { error: updateError } = await supabase
      .from("item")
      .update({ properties: properties })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating the properties:", updateError);
      return res.status(500).json({ message: "Error updating the properties" });
    }

    res.status(200).json({ message: "The option was added successfully", properties: properties });

  } catch (err) {
    console.log("An error has occurred:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/deleteProperty", async (req, res) => {
  console.log("The /deleteProperty was ent ered");
  const { itemComponentID, propertyName } = req.body;

  if (!itemComponentID || !propertyName) {
    return res.status(400).json({ message: "itemComponentID and propertyName are required" });
  }

  try {
    // 1. Resolve itemType_id from the component_id, via the item table
    const { data: item, error: itemError } = await supabase
      .from("item")
      .select("itemType_id")
      .eq("component_id", itemComponentID)
      .single();

    if (itemError) {
      console.error("Error fetching item:", itemError);
      return res.status(500).json({ message: "Error fetching item" });
    }

    const itemType_id = item.itemType_id;
    console.log("Resolved itemType_id: " + itemType_id);

    // 2. Fetch the itemType's current properties using itemType_id
    const { data: existing, error: fetchError } = await supabase
      .from("itemType")
      .select("properties")
      .eq("itemType_id", itemType_id)
      .single();

    if (fetchError) {
      console.error("Error fetching existing properties:", fetchError);
      return res.status(500).json({ message: "Error fetching existing properties" });
    }

    const currentProperties = existing.properties || [];

    // 3. Check the property actually exists on the itemType
    const propertyExists = currentProperties.some(
      (prop) => prop.property.toLowerCase() === propertyName.toLowerCase()
    );

    if (!propertyExists) {
      console.log("The property was not found: " + propertyName);
      return res.status(404).json({ message: "The property was not found" });
    }

    // 4. Remove it from the itemType definition
    const updatedProperties = currentProperties.filter(
      (prop) => prop.property.toLowerCase() !== propertyName.toLowerCase()
    );

    const { error: updateError } = await supabase
      .from("itemType")
      .update({ properties: updatedProperties })
      .eq("itemType_id", itemType_id);

    if (updateError) {
      console.error("Error updating itemType properties:", updateError);
      return res.status(500).json({ message: "Error updating itemType properties" });
    }

    // 5. Fetch every item that has this itemType_id, and remove the property from each
    const { data: items, error: fetchError2 } = await supabase
      .from("item")
      .select("item_id, properties")
      .eq("itemType_id", itemType_id);

    if (fetchError2) {
      console.error("Error fetching items:", fetchError2);
      return res.status(500).json({ message: "Error fetching items" });
    }

    const updates = items.map((it) => {
      const currentItemProperties = it.properties || [];
      const updatedItemProperties = currentItemProperties.filter(
        (prop) => prop.property.toLowerCase() !== propertyName.toLowerCase()
      );
      return supabase
        .from("item")
        .update({ properties: updatedItemProperties })
        .eq("item_id", it.item_id);
    });

    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error("Error updating item properties:", failed.error);
      return res.status(500).json({ message: "Error updating item properties" });
    }

    res.status(200).json({
      properties: updatedProperties,
      message: "Property deleted successfully",
    });

  } catch (err) {
    console.error("An error has occurred:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/deleteOption", async (req, res) => {
  console.log("The /deleteOption was entered");
  const { itemComponentID, propertyName, opt } = req.body;

  console.log("The itemComponentID is: " + itemComponentID);
  console.log("The propertyName is: " + propertyName);
  console.log("The opt is: " + opt);

  if (!itemComponentID || !propertyName || opt === undefined || opt === "") {
    return res.status(400).json({ message: "itemComponentID, propertyName and opt are required" });
  }

  try {
    // 1. Fetch the item's properties using component_id
    const { data: item, error: fetchError } = await supabase
      .from("item")
      .select("properties")
      .eq("component_id", itemComponentID)
      .single();

    if (fetchError) {
      console.log("Error fetching the item's properties:", fetchError);
      return res.status(500).json({ message: "Error fetching the item's properties" });
    }

    const properties = item.properties || [];

    // 2. Find the target property
    const propertyIndex = properties.findIndex(
      (prop) => prop.property.toLowerCase() === propertyName.toLowerCase()
    );

    if (propertyIndex === -1) {
      console.log("The property was not found: " + propertyName);
      return res.status(404).json({ message: "The property was not found" });
    }

    const targetProperty = properties[propertyIndex];

    console.log("The target property is: ");
    console.log(targetProperty);
    // 3. Check the option actually exists
    const optionExists = targetProperty.options.some((o) => {
    const normalizedOption = String(o).toLowerCase();
    const normalizedOpt = String(opt).toLowerCase();
    console.log(`Comparing existing option "${normalizedOption}" (raw: ${o}) with new opt "${normalizedOpt}" (raw: ${opt})`);
    return normalizedOption === normalizedOpt;
  });

    if (!optionExists) {
      console.log("The option does not exist for this property");
      return res.status(404).json({ message: "The option does not exist for this property" });
    }

    // 4. Remove the option
    targetProperty.options = targetProperty.options.filter(
      (o) => String(o).toLowerCase() !== String(opt).toLowerCase()
    );
    properties[propertyIndex] = targetProperty;

    // 5. Update the item's properties in the database
    const { error: updateError } = await supabase
      .from("item")
      .update({ properties: properties })
      .eq("component_id", itemComponentID);

    if (updateError) {
      console.log("Error updating the properties:", updateError);
      return res.status(500).json({ message: "Error updating the properties" });
    }

    res.status(200).json({ message: "The option was deleted successfully", properties: properties });

  } catch (err) {
    console.log("An error has occurred:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/addToCart", async(req,res)=>{
    const {email, productName, totalWeight, totalPrice}=req.query;
try{
        const { data: existingEmail } = await supabase.from("userProducts").select("email").eq("email", email);
        if(existingEmail.length===0){
          const {error}=await supabase.from("userProducts").insert({email: email, product: productName, totalweight: totalWeight, totalprice: totalPrice});
          if(error)
            return res.status(400).json({success: false, message: "Error adding the user to the database"});
          res.status(200).json({success: true, message: "The data was added to the database successfully"});
        }
        else{
        const { data: existingProduct} = await supabase.from("userProducts").select("*").eq("email",email).eq("product",productName).maybeSingle();
        if(!existingProduct){
          const { error }= await supabase.from("userProducts").insert({email: email, product: productName, totalweight: totalWeight, totalprice: totalPrice});
          if(error)
            return res.status(400).json({success: false, message: "Error adding the products to the user's page"});
          res.status(200).json({success: true, message: "The product of the user was added to the database successfully"});
        }
        else{
          const {error}=await supabase.from("userProducts").update({totalweight: (existingProduct.totalweight)+parseFloat(totalWeight), totalprice: (existingProduct.totalprice)+parseFloat(totalPrice)}).eq("email",email).eq("product",productName);
          if(error)
            return res.status(400).json({success: false, message: "Error updating the products of the user"});
          res.status(200).json({success: true, message: "The data was updated successfully"});
        }
      }
    }
    catch(err){
return res.status(500).json({success: false, message: "Supabase error"});
    }
});

app.use("/api", specificProducts);
app.use("/api", itemRouter);
app.use("/api", userProductsRouter);

app.get("/debug", (req, res) => {
  res.json({
    status: "Server running",
    time: new Date().toISOString(),
    database: "Supabase",
    endpoints: [
      "/login",
      "/signUp",
      "/logout",
      "/api/products/:category",
      "/api/item/:category/:product",
      "/api/userProducts?email=...",
    ],
  });
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
